import { promises as dns } from 'node:dns';
import { env } from '../env';
import { AppError } from '../errors';
import { getWorkspace, listStaff, updateWorkspace, upsertIncomingConversation } from '../db/repo';
import { assertSafeHttpUrl, isPrivateAddress } from '../../shared/net';
import { parseHarasocialApiResponse } from '../../shared/harasocial';
import { applyHrPayload, type HrApplySummary } from './hr-sync-service';
import { broadcast } from './events';
import type { ChannelConfig, WorkspaceConfig } from '../../shared/types';

async function assertSafeResolvedUrl(raw: string, label: string): Promise<URL> {
  const url = assertSafeHttpUrl(raw, {
    requireHttps: !env.allowInsecurePull,
    allowLocalhost: env.allowInsecurePull,
  });
  if (!env.allowInsecurePull) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    const blocked = addresses.find((a) => isPrivateAddress(a.address));
    if (blocked) {
      throw new Error(`${label} phân giải tới địa chỉ nội bộ (${blocked.address}) — đã chặn SSRF.`);
    }
  }
  return url;
}

async function fetchJson(url: URL, token: string, label: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'HaraSocial-Monitor/1.0',
      },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${label} trả HTTP ${response.status}.`);
    }
    const text = await response.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label} trả dữ liệu không phải JSON.`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface ChannelPullResult {
  channelId: string;
  channelName: string;
  ok: boolean;
  conversations: number;
  created: number;
  skipped: number;
  error?: string;
}

async function pullChannel(ownerUid: string, channel: ChannelConfig): Promise<ChannelPullResult> {
  const base: ChannelPullResult = {
    channelId: channel.id,
    channelName: channel.name,
    ok: false,
    conversations: 0,
    created: 0,
    skipped: 0,
  };
  try {
    const rawUrl = String(channel.harasocialApiUrl || '').trim();
    const token = String(channel.harasocialAccessToken || '').trim();
    if (!rawUrl || !token) throw new Error('Chưa cấu hình API URL hoặc Access Token.');
    const url = await assertSafeResolvedUrl(rawUrl, 'HaraSocial API');
    const json = await fetchJson(url, token, 'HaraSocial API');
    const incoming = parseHarasocialApiResponse(json, { pageId: channel.harasocialPageId || null });
    base.conversations = incoming.length;
    for (const item of incoming) {
      const result = await upsertIncomingConversation(ownerUid, channel.id, item);
      if (result.created) base.created += 1;
      if (result.skipped) base.skipped += 1;
    }
    base.ok = true;
    return base;
  } catch (e) {
    base.error = (e as Error).message;
    return base;
  }
}

/** Kéo hội thoại song song tất cả cổng đang bật (cổng lỗi không ảnh hưởng cổng khác). */
export async function pullHarasocialForOwner(
  ownerUid: string,
  workspaceInput?: WorkspaceConfig
): Promise<{ ok: boolean; channels: ChannelPullResult[]; total: number }> {
  const workspace = workspaceInput || (await getWorkspace(ownerUid));
  if (!workspace) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Không tìm thấy cấu hình tài khoản.');
  const targets = workspace.channels.filter(
    (c) => c.active !== false && String(c.harasocialApiUrl || '').trim() && String(c.harasocialAccessToken || '').trim()
  );

  const settled = await Promise.allSettled(targets.map((channel) => pullChannel(ownerUid, channel)));
  const results: ChannelPullResult[] = settled.map((s, index) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      channelId: targets[index].id,
      channelName: targets[index].name,
      ok: false,
      conversations: 0,
      created: 0,
      skipped: 0,
      error: (s.reason as Error)?.message || 'Lỗi không xác định',
    };
  });

  if (results.length > 0) {
    const at = new Date().toISOString();
    const channels = workspace.channels.map((channel) => {
      const result = results.find((r) => r.channelId === channel.id);
      if (!result) return channel;
      return {
        ...channel,
        lastSyncAt: at,
        lastSyncStatus: result.ok
          ? `OK · ${result.conversations} hội thoại (${result.created} mới)`
          : `Lỗi: ${result.error}`,
      };
    });
    await updateWorkspace(ownerUid, { channels });
    broadcast(ownerUid, 'channels', { at, results });
    broadcast(ownerUid, 'conversations', { source: 'harasocial_pull' });
  }

  return {
    ok: results.every((r) => r.ok) || results.length === 0,
    channels: results,
    total: results.reduce((sum, r) => sum + r.conversations, 0),
  };
}

export interface HrPullResult {
  ok: boolean;
  summary?: HrApplySummary;
  error?: string;
}

/** Phương án dự phòng: kéo GET API lịch làm việc từ Web App Nhân sự. */
export async function pullHrForOwner(ownerUid: string, workspaceInput?: WorkspaceConfig): Promise<HrPullResult> {
  const workspace = workspaceInput || (await getWorkspace(ownerUid));
  if (!workspace) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Không tìm thấy cấu hình tài khoản.');
  const hr = workspace.hr;
  if (!hr.enabled) return { ok: true };
  const rawUrl = String(hr.apiUrl || '').trim();
  const token = String(hr.apiToken || '').trim();
  if (!rawUrl || !token) {
    const detail = 'Chưa cấu hình HR API URL hoặc token.';
    await updateWorkspace(ownerUid, { hr: { ...hr, lastSyncAt: new Date().toISOString(), lastSyncStatus: `Lỗi: ${detail}` } });
    return { ok: false, error: detail };
  }

  try {
    const url = await assertSafeResolvedUrl(rawUrl, 'HR API');
    const json = await fetchJson(url, token, 'HR API');
    const summary = await applyHrPayload(ownerUid, json, hr.autoCreateMissingStaff === true);
    await updateWorkspace(ownerUid, {
      hr: {
        ...hr,
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: `OK · khớp ${summary.matched}, tạo ${summary.created}, bỏ qua ${summary.unmatched.length}`,
      },
    });
    broadcast(ownerUid, 'hr', summary);
    return { ok: true, summary };
  } catch (e) {
    const detail = (e as Error).message;
    await updateWorkspace(ownerUid, {
      hr: { ...hr, lastSyncAt: new Date().toISOString(), lastSyncStatus: `Lỗi: ${detail}` },
    });
    return { ok: false, error: detail };
  }
}

/** Khi HR webhook tới: đánh dấu trạng thái đồng bộ gần nhất. */
export async function markHrSynced(ownerUid: string, summary: HrApplySummary): Promise<void> {
  const workspace = await getWorkspace(ownerUid);
  if (!workspace) return;
  await updateWorkspace(ownerUid, {
    hr: {
      ...workspace.hr,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: `Webhook · nhận ${summary.received}, khớp ${summary.matched}, tạo ${summary.created}`,
    },
  });
  broadcast(ownerUid, 'hr', summary);
}

export async function listDutyStaffSafe(ownerUid: string) {
  return listStaff(ownerUid);
}
