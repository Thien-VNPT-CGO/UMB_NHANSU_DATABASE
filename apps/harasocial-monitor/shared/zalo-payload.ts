/** Payload gửi Zalo (webhook trung gian, OA Nhóm GMF v3.0, OA 1-1) — logic thuần. */
import type { SalesStaff } from './types';

export interface AlertPayloadInput {
  groupId: string;
  groupName: string;
  taggedStaff: SalesStaff[];
  title: string;
  message: string;
  text: string;
  category?: string;
}

export interface WebhookAlertPayload {
  groupId: string;
  groupName: string;
  taggedStaff: Array<{ id: string; name: string; zaloTag: string; zaloUserId: string }>;
  title: string;
  message: string;
  text: string;
  category: string;
}

/** JSON chuẩn cho Make.com / n8n. */
export function buildWebhookPayload(input: AlertPayloadInput): WebhookAlertPayload {
  return {
    groupId: String(input.groupId || ''),
    groupName: String(input.groupName || ''),
    taggedStaff: (input.taggedStaff || []).map((s) => ({
      id: String(s.id || ''),
      name: String(s.name || ''),
      zaloTag: String(s.zaloTag || ''),
      zaloUserId: String(s.zaloUserId || ''),
    })),
    title: String(input.title || ''),
    message: String(input.message || ''),
    text: String(input.text || ''),
    category: String(input.category || 'harasocial_sla_alert'),
  };
}

export function buildOaGroupPayload(groupId: string, text: string) {
  // GMF v3.0 — Zalo OA Group Message.
  return {
    recipient: { group_id: String(groupId || '') },
    message: { text: String(text || '') },
  };
}

export function buildOaUserPayload(userId: string, text: string) {
  return {
    recipient: { user_id: String(userId || '') },
    message: { text: String(text || '') },
  };
}

export interface ZaloApiCheck {
  success: boolean;
  errorCode: number | null;
  message: string;
}

/**
 * Zalo OpenAPI có thể trả HTTP 200 nhưng body { error: 123 }.
 * Luôn kiểm tra cả HTTP status và error code.
 */
export function checkZaloApiResponse(status: number, body: unknown): ZaloApiCheck {
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    return {
      success: false,
      errorCode: null,
      message: `Zalo trả HTTP ${status || '?'}.`,
    };
  }
  if (!body || typeof body !== 'object') {
    return { success: false, errorCode: null, message: 'Zalo trả phản hồi rỗng hoặc không phải JSON.' };
  }
  const obj = body as Record<string, unknown>;
  const rawError = obj.error ?? obj.errorCode ?? obj.error_code ?? obj.code;
  let errorCode: number | null = null;
  if (typeof rawError === 'number') errorCode = rawError;
  else if (typeof rawError === 'string' && rawError.trim() !== '' && Number.isFinite(Number(rawError))) errorCode = Number(rawError);

  if (errorCode !== null && errorCode !== 0) {
    const msg = String(obj.message ?? obj.error_message ?? obj.description ?? `Lỗi Zalo ${errorCode}`);
    return { success: false, errorCode, message: msg };
  }
  if (obj.error === true || obj.success === false) {
    return { success: false, errorCode, message: String(obj.message ?? 'Zalo báo thất bại.') };
  }
  return { success: true, errorCode: 0, message: String(obj.message ?? 'OK') };
}

/** Kiểm tra phản hồi webhook trung gian (Make/n8n) — chặn trang HTML đăng nhập. */
export function checkWebhookResponse(status: number, bodyText: string): ZaloApiCheck {
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    return { success: false, errorCode: null, message: `Webhook trả HTTP ${status || '?'}.` };
  }
  const text = String(bodyText || '').trim();
  if (text.startsWith('<')) {
    return {
      success: false,
      errorCode: null,
      message: 'Webhook trả về HTML (có thể là trang đăng nhập) — không phải endpoint công khai.',
    };
  }
  return { success: true, errorCode: 0, message: 'OK' };
}
