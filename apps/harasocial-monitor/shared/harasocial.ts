/** Phân tích webhook/API HaraSocial — logic thuần. */
import type { HarasocialChannel, MessageSender } from './types';

export interface IncomingConversation {
  externalId: string;
  customerName: string;
  channel: HarasocialChannel;
  lastMessage: string;
  lastSender: MessageSender;
  at: Date;
  assignedStaffId: string | null;
  rawSender?: string;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function pick(obj: Dict, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return undefined;
}

function pickStr(obj: Dict, keys: string[]): string {
  return str(pick(obj, keys)).trim();
}

/** Chuẩn hoá tên kênh hiển thị. */
export function normalizeChannel(value: unknown): HarasocialChannel {
  const raw = str(value).trim();
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (!key) return 'Livechat';
  if (key.includes('facebook') || key === 'fb' || key.includes('messenger')) return 'Facebook';
  if (key.includes('instagram') || key === 'ig') return 'Instagram';
  if (key.includes('zalo') || key === 'oa') return 'Zalo OA';
  if (key.includes('livechat') || key.includes('webchat') || key.includes('website') || key.includes('widget')) return 'Livechat';
  return raw;
}

/** Xác định người gửi: customer | staff. */
export function detectSender(raw: Dict, pageId?: string | null): MessageSender {
  const flag = pick(raw, ['isFromCustomer', 'is_from_customer', 'fromCustomer', 'from_customer']);
  if (typeof flag === 'boolean') return flag ? 'customer' : 'staff';
  if (typeof flag === 'string') {
    if (/^(true|1|yes|customer|user)$/i.test(flag.trim())) return 'customer';
    if (/^(false|0|no|staff|page)$/i.test(flag.trim())) return 'staff';
  }

  const direction = pickStr(raw, ['direction', 'messageDirection', 'message_direction']).toLowerCase();
  if (['inbound', 'incoming', 'in', 'received'].includes(direction)) return 'customer';
  if (['outbound', 'outgoing', 'out', 'sent'].includes(direction)) return 'staff';

  const senderObj = pick(raw, ['sender', 'from', 'author', 'user']);
  let senderText = '';
  if (isDict(senderObj)) {
    senderText = pickStr(senderObj, ['type', 'role', 'senderType', 'sender_type', 'kind']);
    const senderId = pickStr(senderObj, ['id', 'uid', 'pageId', 'page_id']);
    if (pageId && senderId && senderId === pageId) return 'staff';
  } else {
    senderText = str(senderObj);
  }

  const senderType = [senderText, pickStr(raw, ['senderType', 'sender_type', 'fromType', 'from_type', 'role', 'authorType'])].join(' ').toLowerCase();
  if (/(customer|client|visitor|user|khach|inbound)/.test(senderType)) return 'customer';
  if (/(staff|agent|admin|page|shop|seller|bot|outbound|nhanvien)/.test(senderType)) return 'staff';

  const fromId = isDict(senderObj)
    ? pickStr(senderObj, ['id', 'uid', 'pageId', 'page_id'])
    : pickStr(raw, ['fromId', 'from_id', 'senderId', 'sender_id']);
  if (pageId && fromId && fromId === pageId) return 'staff';

  return 'customer';
}

export function parseTimestamp(value: unknown, fallback: Date = new Date()): Date {
  if (value === null || value === undefined || value === '') return fallback;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? fallback : d;
  }
  const text = String(value).trim();
  if (!text) return fallback;
  if (/^\d+$/.test(text)) return parseTimestamp(Number(text), fallback);

  // dd/mm/yyyy [hh:mm[:ss]] — hiểu theo giờ Việt Nam.
  const vn = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (vn) {
    const [, d, mo, y, h = '0', mi = '0', s = '0'] = vn;
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${s.padStart(2, '0')}+07:00`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const ms = Date.parse(text);
  return Number.isNaN(ms) ? fallback : new Date(ms);
}

function messageText(raw: Dict): string {
  const direct = pick(raw, [
    'lastMessage',
    'last_message',
    'lastMessageText',
    'last_message_text',
    'messageText',
    'message_text',
    'message',
    'text',
    'content',
    'body',
    'msg',
  ]);
  if (typeof direct === 'string' || typeof direct === 'number') {
    return str(direct).trim();
  }
  const nested = pick(raw, ['message', 'lastMessage', 'last_message', 'latestMessage', 'latest_message']);
  if (isDict(nested)) {
    const inner = pick(nested, ['text', 'content', 'msg', 'body', 'message', 'snippet']);
    return str(inner).trim();
  }
  return '';
}

function flattenItem(item: Dict): Dict {
  // Một số webhook tách { conversation, message } — gộp lại để đọc 1 lần.
  const conversation = pick(item, ['conversation', 'thread', 'chat']);
  const message = pick(item, ['message', 'lastMessage', 'last_message']);
  const customer = pick(item, ['customer', 'contact', 'profile']);
  const merged: Dict = { ...item };
  if (isDict(conversation)) {
    for (const [k, v] of Object.entries(conversation)) if (merged[k] === undefined) merged[k] = v;
  }
  if (isDict(customer)) {
    if (merged.customerName === undefined) merged.customerName = pick(customer, ['name', 'fullName', 'displayName']);
    if (merged.customerId === undefined) merged.customerId = pick(customer, ['id', 'uid', 'customerId']);
  }
  if (isDict(message)) {
    // Chỉ lấy văn bản/nội dung; giữ sender của message nếu có.
    merged.__messageText = pick(message, ['text', 'content', 'msg', 'body', 'snippet']);
    for (const key of ['sender', 'from', 'direction', 'senderType', 'sender_type', 'createdAt', 'created_at', 'sentAt', 'sent_at', 'timestamp', 'isFromCustomer']) {
      if (merged[key] === undefined && message[key] !== undefined) merged[key] = message[key];
    }
  }
  return merged;
}

function normalizeConversation(rawItem: Dict, pageId?: string | null): IncomingConversation | null {
  const raw = flattenItem(rawItem);
  const externalId = pickStr(raw, [
    'conversationId',
    'conversation_id',
    'threadId',
    'thread_id',
    'sessionId',
    'session_id',
    'chatId',
    'chat_id',
    'customerId',
    'customer_id',
    'id',
  ]);

  const customerName = pickStr(raw, [
    'customerName',
    'customer_name',
    'customerTitle',
    'senderName',
    'sender_name',
    'fromName',
    'from_name',
    'displayName',
    'display_name',
    'name',
  ]) || 'Khách hàng';

  const channel = normalizeChannel(pick(raw, ['channel', 'platform', 'source', 'channelType', 'channel_type', 'type']));
  const lastMessage = str(raw.__messageText).trim() || messageText(raw);
  const sender = detectSender(raw, pageId);
  const time = pick(raw, ['timestamp', 'time', 'createdAt', 'created_at', 'sentAt', 'sent_at', 'lastMessageAt', 'last_message_at', 'updatedAt', 'updated_at']);
  const at = parseTimestamp(time, new Date());

  const fallbackId = customerName !== 'Khách hàng'
    ? `customer:${slugChannelKey(customerName)}`
    : '';
  const finalId = externalId || fallbackId;
  if (!finalId) return null;

  const assigned = pickStr(raw, ['assignedStaffId', 'assigned_staff_id', 'staffId', 'staff_id', 'assigneeId', 'assignee_id']);

  return {
    externalId: finalId,
    customerName,
    channel,
    lastMessage,
    lastSender: sender,
    at,
    assignedStaffId: assigned || null,
    rawSender: isDict(pick(raw, ['sender', 'from'])) ? pickStr(pick(raw, ['sender', 'from']) as Dict, ['type', 'role', 'id']) : str(pick(raw, ['sender', 'from'])),
  };
}

function looksLikeConversation(obj: Dict): boolean {
  return [
    'conversationId', 'conversation_id', 'threadId', 'thread_id', 'sessionId', 'session_id',
    'lastMessage', 'last_message', 'lastMessageText', 'customerName', 'customer_name',
    'messageText', 'message_text', 'channel', 'platform',
  ].some((k) => obj[k] !== undefined);
}

function collectItems(payload: unknown, depth = 0): Dict[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((x) => collectItems(x, depth + 1));
  }
  if (!isDict(payload)) return [];
  if (looksLikeConversation(payload) || (isDict(payload.conversation) && (isDict(payload.message) || payload.message !== undefined))) {
    return [payload];
  }
  if (depth > 3) return [];
  const out: Dict[] = [];
  for (const key of ['conversations', 'items', 'results', 'records', 'rows', 'events', 'data', 'payload', 'conversation_list']) {
    if (payload[key] !== undefined) {
      for (const item of collectItems(payload[key], depth + 1)) {
        if (!out.includes(item)) out.push(item);
      }
    }
  }
  if (out.length === 0 && depth === 0) return [payload];
  return out;
}

/** Parse cả webhook và API response. `pageId` giúp nhận diện tin do page gửi. */
export function parseHarasocialPayload(payload: unknown, options: { pageId?: string | null } = {}): IncomingConversation[] {
  const items = collectItems(payload);
  const out: IncomingConversation[] = [];
  for (const item of items) {
    const conv = normalizeConversation(item, options.pageId);
    if (conv) out.push(conv);
  }
  return out;
}

export const parseHarasocialWebhook = parseHarasocialPayload;
export const parseHarasocialApiResponse = parseHarasocialPayload;

/** ID hội thoại tách biệt theo cổng: cùng externalId ở 2 cổng không ghi đè nhau. */
export function buildConversationId(channelId: string, externalId: string): string {
  const cid = String(channelId || '').trim();
  const ext = String(externalId || '').trim().slice(0, 180);
  return `${cid}:${ext}`;
}

/** Khoá kênh thân thiện cho URL webhook. */
export function slugChannelKey(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
