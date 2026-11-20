import { env } from '../env';
import { assertSafeHttpUrl } from '../../shared/net';
import {
  buildOaGroupPayload,
  buildOaUserPayload,
  buildWebhookPayload,
  checkWebhookResponse,
  checkZaloApiResponse,
} from '../../shared/zalo-payload';
import type { AlertSendMode, ChannelConfig, WorkspaceConfig, ZaloMentionMessage } from '../../shared/types';
import { buildGroupTestText } from '../../shared/alert-text';
import { sendGroupMessage } from './zalo-personal';
import { channelGroups } from '../db/repo';

export interface DeliveryResult {
  groupId: string;
  groupName: string;
  provider: AlertSendMode;
  mode: 'live_api' | 'sandbox_log';
  success: boolean;
  detail: string;
}

export interface DeliveryInput {
  ownerUid: string;
  workspace: WorkspaceConfig;
  channel: ChannelConfig;
  message: ZaloMentionMessage;
  title: string;
  body: string;
  category?: string;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timer);
  }
}

function safeUrl(raw: string, label: string): URL {
  try {
    return assertSafeHttpUrl(raw, {
      requireHttps: !env.allowInsecurePull,
      allowLocalhost: env.allowInsecurePull,
    });
  } catch (e) {
    throw new Error(`${label}: ${(e as Error).message}`);
  }
}

function modeOf(workspace: WorkspaceConfig, channel: ChannelConfig): AlertSendMode {
  if (String(channel.zaloWebhookUrl || '').trim()) return 'webhook';
  const mode = workspace.zalo.mode;
  if (mode === 'webhook' || mode === 'oa_group' || mode === 'oa_user' || mode === 'personal') return mode;
  return 'personal';
}

async function sendWebhook(
  url: string,
  payload: ReturnType<typeof buildWebhookPayload>
): Promise<{ success: boolean; detail: string }> {
  try {
    const safe = safeUrl(url, 'Webhook Zalo');
    const response = await fetchWithTimeout(safe.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-harasocial-source': 'harasocial-monitor',
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const check = checkWebhookResponse(response.status, text);
    return { success: check.success, detail: check.success ? `HTTP ${response.status}` : check.message };
  } catch (e) {
    return { success: false, detail: (e as Error).message };
  }
}

async function sendOaGroup(token: string, groupId: string, text: string): Promise<{ success: boolean; detail: string }> {
  try {
    const response = await fetchWithTimeout('https://openapi.zalo.me/v3.0/oa/group/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: token,
      },
      body: JSON.stringify(buildOaGroupPayload(groupId, text)),
    });
    const body = await response.json().catch(() => null);
    const check = checkZaloApiResponse(response.status, body);
    return { success: check.success, detail: check.success ? `HTTP ${response.status}` : `${check.message} (error=${check.errorCode ?? '?'})` };
  } catch (e) {
    return { success: false, detail: (e as Error).message };
  }
}

async function sendOaUser(
  token: string,
  userId: string,
  text: string
): Promise<{ success: boolean; detail: string }> {
  try {
    const response = await fetchWithTimeout('https://openapi.zalo.me/v3.0/oa/message/cs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: token,
      },
      body: JSON.stringify(buildOaUserPayload(userId, text)),
    });
    const body = await response.json().catch(() => null);
    const check = checkZaloApiResponse(response.status, body);
    return { success: check.success, detail: check.success ? `HTTP ${response.status}` : `${check.message} (error=${check.errorCode ?? '?'})` };
  } catch (e) {
    return { success: false, detail: (e as Error).message };
  }
}

/** Gửi cảnh báo tới TẤT CẢ nhóm Zalo đã gắn với cổng. */
export async function deliverAlert(input: DeliveryInput): Promise<DeliveryResult[]> {
  const mode = modeOf(input.workspace, input.channel);
  const groups = channelGroups(input.channel);
  if (groups.length === 0) {
    return [
      {
        groupId: '',
        groupName: '(chưa cấu hình nhóm)',
        provider: mode,
        mode: 'sandbox_log',
        success: true,
        detail: 'Cổng chưa gắn nhóm Zalo — cảnh báo chỉ được ghi nhận vào nhật ký.',
      },
    ];
  }

  const results: DeliveryResult[] = [];
  for (const group of groups) {
    let result: { success: boolean; detail: string };
    if (mode === 'personal') {
      const sent = await sendGroupMessage(input.ownerUid, group.id, {
        msg: input.message.text,
        mentions: input.message.mentions,
      });
      result = { success: sent.success, detail: sent.detail };
    } else if (mode === 'webhook') {
      const url = String(input.channel.zaloWebhookUrl || input.workspace.zalo.webhookUrl || '').trim();
      if (!url) {
        result = { success: false, detail: 'Chưa cấu hình Webhook URL (Make/n8n).' };
      } else {
        result = await sendWebhook(
          url,
          buildWebhookPayload({
            groupId: group.id,
            groupName: group.name,
            taggedStaff: input.message.tagged,
            title: input.title,
            message: input.message.text,
            text: input.message.text,
            category: input.category,
          })
        );
      }
    } else if (mode === 'oa_group') {
      const token = String(input.workspace.zalo.oaToken || '').trim();
      result = token
        ? await sendOaGroup(token, group.id, input.message.text)
        : { success: false, detail: 'Chưa cấu hình OA access token.' };
    } else {
      const token = String(input.workspace.zalo.oaToken || '').trim();
      const uids = [...new Set(input.message.tagged.map((s) => String(s.zaloUserId || '').trim()).filter(Boolean))];
      if (!token) {
        result = { success: false, detail: 'Chưa cấu hình OA access token.' };
      } else if (!uids.length) {
        result = { success: false, detail: 'Không có nhân viên nào có Zalo UID hợp lệ để gửi OA 1-1.' };
      } else {
        const sent = await Promise.allSettled(uids.map((uid) => sendOaUser(token, uid, input.message.text)));
        const ok = sent.filter((s) => s.status === 'fulfilled' && s.value.success).length;
        const errors = sent
          .map((s) => (s.status === 'fulfilled' ? (s.value.success ? '' : s.value.detail) : (s.reason as Error)?.message || 'lỗi'))
          .filter(Boolean);
        result = {
          success: ok > 0,
          detail: ok > 0 ? `Đã gửi ${ok}/${uids.length} nhân viên.` : `Gửi OA 1-1 thất bại: ${errors.join('; ')}`,
        };
      }
    }

    results.push({
      groupId: group.id,
      groupName: group.name,
      provider: mode,
      mode: 'live_api',
      success: result.success,
      detail: result.detail,
    });
  }
  return results;
}

/** Test gửi 1 nhóm (không tag) — dùng nút trong cấu hình cổng. */
export async function sendTestGroup(
  ownerUid: string,
  workspace: WorkspaceConfig,
  channel: ChannelConfig,
  group: { id: string; name: string }
): Promise<DeliveryResult> {
  const mode = modeOf(workspace, channel);
  const text = buildGroupTestText(group.name);
  if (mode === 'personal') {
    const sent = await sendGroupMessage(ownerUid, group.id, { msg: text });
    return { groupId: group.id, groupName: group.name, provider: mode, mode: 'live_api', success: sent.success, detail: sent.detail };
  }
  if (mode === 'webhook') {
    const url = String(channel.zaloWebhookUrl || workspace.zalo.webhookUrl || '').trim();
    const result = url
      ? await sendWebhook(url, buildWebhookPayload({
          groupId: group.id,
          groupName: group.name,
          taggedStaff: [],
          title: 'Kiểm tra kết nối',
          message: text,
          text,
          category: 'harasocial_test',
        }))
      : { success: false, detail: 'Chưa cấu hình Webhook URL.' };
    return { groupId: group.id, groupName: group.name, provider: mode, mode: 'live_api', success: result.success, detail: result.detail };
  }
  if (mode === 'oa_group') {
    const token = String(workspace.zalo.oaToken || '').trim();
    const result = token
      ? await sendOaGroup(token, group.id, text)
      : { success: false, detail: 'Chưa cấu hình OA access token.' };
    return { groupId: group.id, groupName: group.name, provider: mode, mode: 'live_api', success: result.success, detail: result.detail };
  }
  return {
    groupId: group.id,
    groupName: group.name,
    provider: mode,
    mode: 'live_api',
    success: false,
    detail: 'Chế độ OA 1-1 không hỗ trợ gửi vào nhóm. Hãy chọn Zalo cá nhân, Webhook hoặc OA Nhóm.',
  };
}
