import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../errors';
import { env } from '../env';
import { assertSafeHttpUrl } from '../../shared/net';
import { slugChannelKey } from '../../shared/harasocial';
import type { AlertSendMode, ChannelConfig, HrConfig, ZaloConfig, ZaloGroupRef } from '../../shared/types';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function requestBase(req: Request): string {
  if (env.publicUrl) return env.publicUrl;
  return `${req.protocol}://${req.get('host')}`;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function secretFrom(req: Request, headerNames: string[]): string {
  for (const name of headerNames) {
    const value = req.headers[name.toLowerCase()];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const query = req.query.secret || req.query.token;
  if (typeof query === 'string' && query.trim()) return query.trim();
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function text(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max);
}

function optionalText(value: unknown, max = 500): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, max);
}

function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const t = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(t)) return true;
  if (['false', '0', 'no', 'off'].includes(t)) return false;
  return undefined;
}

export function normalizeGroups(value: unknown): ZaloGroupRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ZaloGroupRef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = text(item.id ?? item.groupId ?? item.group_id, 100);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: text(item.name ?? item.groupName ?? item.group_name, 160) || id });
  }
  return out;
}

function validateOptionalUrl(raw: string | undefined, label: string): string | undefined {
  const value = String(raw || '').trim();
  if (!value) return value;
  try {
    assertSafeHttpUrl(value, { requireHttps: !env.allowInsecurePull, allowLocalhost: env.allowInsecurePull });
    return value;
  } catch (e) {
    throw new AppError(400, 'INVALID_URL', `${label}: ${(e as Error).message}`);
  }
}

export function sanitizeChannels(value: unknown, previous: ChannelConfig[]): ChannelConfig[] {
  if (!Array.isArray(value)) throw new AppError(400, 'INVALID_CHANNELS', 'Danh sách cổng không hợp lệ.');
  const prevById = new Map(previous.map((c) => [c.id, c]));
  const usedKeys = new Set<string>();
  const out: ChannelConfig[] = [];

  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Record<string, unknown>;
    const id = text(item.id, 100) || `ch_${randomBytes(6).toString('hex')}`;
    const old = prevById.get(id);
    const name = text(item.name, 120) || old?.name || `Cổng HaraSocial ${index + 1}`;
    let channelKey = slugChannelKey(text(item.channelKey, 60) || old?.channelKey || name) || `cong-${index + 1}`;
    if (usedKeys.has(channelKey)) channelKey = `${channelKey}-${index + 1}`;
    usedKeys.add(channelKey);

    const zaloGroups = normalizeGroups(item.zaloGroups !== undefined ? item.zaloGroups : old?.zaloGroups);
    const sla = clampNumber(item.slaThresholdMinutes ?? old?.slaThresholdMinutes, 0, 10080);

    out.push({
      id,
      name,
      channelKey,
      zaloGroups,
      zaloGroupId: optionalText(item.zaloGroupId ?? old?.zaloGroupId, 100),
      zaloGroupName: optionalText(item.zaloGroupName ?? old?.zaloGroupName, 160),
      zaloWebhookUrl: validateOptionalUrl(
        optionalText(item.zaloWebhookUrl ?? old?.zaloWebhookUrl, 1000),
        'Webhook Zalo của cổng'
      ),
      harasocialApiUrl: validateOptionalUrl(
        optionalText(item.harasocialApiUrl ?? old?.harasocialApiUrl, 1000),
        'HaraSocial API URL'
      ),
      harasocialAccessToken: optionalText(item.harasocialAccessToken ?? old?.harasocialAccessToken, 2000),
      harasocialPageId: optionalText(item.harasocialPageId ?? old?.harasocialPageId, 200),
      slaThresholdMinutes: sla,
      notifyOnMissChat: bool(item.notifyOnMissChat ?? old?.notifyOnMissChat) ?? true,
      tagAllOnDutyInShift: bool(item.tagAllOnDutyInShift ?? old?.tagAllOnDutyInShift) ?? false,
      lastSyncAt: old?.lastSyncAt ?? null,
      lastSyncStatus: old?.lastSyncStatus ?? null,
      active: bool(item.active ?? old?.active) ?? true,
    });
  });
  return out;
}

export function sanitizeZalo(value: unknown, previous: ZaloConfig): ZaloConfig {
  if (!value || typeof value !== 'object') return previous;
  const item = value as Record<string, unknown>;
  const allowed: AlertSendMode[] = ['personal', 'webhook', 'oa_group', 'oa_user'];
  const mode = allowed.includes(item.mode as AlertSendMode) ? (item.mode as AlertSendMode) : previous.mode;
  return {
    mode,
    oaToken: optionalText(item.oaToken ?? previous.oaToken, 4000),
    webhookUrl: validateOptionalUrl(optionalText(item.webhookUrl ?? previous.webhookUrl, 1000), 'Webhook trung gian'),
    defaultGroupId: optionalText(item.defaultGroupId ?? previous.defaultGroupId, 100),
    defaultGroupName: optionalText(item.defaultGroupName ?? previous.defaultGroupName, 160),
    notifyOnMissChat: bool(item.notifyOnMissChat ?? previous.notifyOnMissChat) ?? true,
    tagAllOnDutyInShift: bool(item.tagAllOnDutyInShift ?? previous.tagAllOnDutyInShift) ?? false,
  };
}

export function sanitizeHr(value: unknown, previous: HrConfig): HrConfig {
  if (!value || typeof value !== 'object') return previous;
  const item = value as Record<string, unknown>;
  return {
    enabled: bool(item.enabled ?? previous.enabled) ?? false,
    webhookSecret: text(item.webhookSecret ?? previous.webhookSecret, 200),
    apiUrl: validateOptionalUrl(optionalText(item.apiUrl ?? previous.apiUrl, 1000), 'HR API URL'),
    apiToken: optionalText(item.apiToken ?? previous.apiToken, 4000),
    autoCreateMissingStaff: bool(item.autoCreateMissingStaff ?? previous.autoCreateMissingStaff) ?? false,
    lastSyncAt: previous.lastSyncAt ?? null,
    lastSyncStatus: previous.lastSyncStatus ?? null,
  };
}

export function generateWebhookSecret(prefix = 'hs'): string {
  return `${prefix}_${randomBytes(18).toString('hex')}`;
}
