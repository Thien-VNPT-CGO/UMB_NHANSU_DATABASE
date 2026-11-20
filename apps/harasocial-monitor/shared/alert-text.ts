/** Soạn nội dung cảnh báo & payload @mention Zalo — logic thuần. */
import { dedupeStaff } from './staff';
import type { AlertText, SalesStaff, ZaloMention, ZaloMentionMessage } from './types';

export interface AlertTextInput {
  channelName: string;
  customerName: string;
  lastMessage: string;
  waitedMinutes: number;
  thresholdMinutes: number;
  /** 0 = cảnh báo đầu tiên; >=1 = nhắc lại lần N. */
  reminderCount: number;
}

function clean(value: unknown, fallback = ''): string {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s || fallback;
}

function truncate(value: string, max = 280): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/** Nội dung tin nhắn cảnh báo gửi vào nhóm Zalo. */
export function buildAlertText(input: AlertTextInput): AlertText {
  const channel = clean(input.channelName, 'HaraSocial');
  const customer = clean(input.customerName, 'Khách hàng');
  const message = truncate(clean(input.lastMessage, '(không có nội dung)'), 260);
  const waited = Math.max(0, Math.floor(Number(input.waitedMinutes) || 0));
  const threshold = Math.max(0, Math.floor(Number(input.thresholdMinutes) || 0));
  const reminder = Math.max(0, Math.floor(Number(input.reminderCount) || 0));

  const title = reminder > 0
    ? `[NHẮC LẠI LẦN ${reminder}] Khách vẫn chưa được phản hồi`
    : 'Khách hàng chưa được phản hồi (quá hạn SLA)';

  const lines = [
    `🚨 [HARASOCIAL] ${title.toUpperCase()}`,
    `Cổng: ${channel}`,
    `Khách hàng: ${customer}`,
    `Đã chờ: ${waited} phút (SLA ${threshold} phút)`,
    `Tin nhắn cuối: "${message}"`,
  ];

  const body = lines.join('\n');
  return { title, body, text: body };
}

/** UID Zalo hợp lệ để tạo mention: chuỗi số, tối thiểu 6 chữ số. */
export function isValidZaloUid(uid: unknown): boolean {
  return /^\d{6,}$/.test(String(uid ?? '').trim());
}

function tagOf(staff: SalesStaff): string {
  return clean(staff.zaloTag) || clean(staff.name) || 'Nhân viên';
}

export interface MentionMessageInput extends AlertTextInput {
  staff: SalesStaff[];
}

/**
 * Tạo nội dung + metadata @mention đúng vị trí (pos/len là offset UTF-16
 * trong chuỗi cuối cùng — Zalo dùng offset ký tự của JS).
 * Chỉ tạo mention khi zaloUserId là UID số hợp lệ (>= 6 chữ số).
 */
export function buildZaloMentionMessage(input: MentionMessageInput): ZaloMentionMessage {
  const alert = buildAlertText(input);
  const staff = dedupeStaff(input.staff || []).filter((s) => clean(s.name) || clean(s.zaloTag));
  const text = alert.text;

  const tagged: SalesStaff[] = [];
  const skipped: SalesStaff[] = [];
  const mentions: ZaloMention[] = [];
  const seenNames = new Set<string>();

  let output = text;
  const tagLine: string[] = [];
  const prepared: Array<{ staff: SalesStaff; label: string; valid: boolean }> = [];

  for (const s of staff) {
    const label = `@${tagOf(s)}`;
    if (seenNames.has(label)) {
      // Cùng tên hiển thị: nếu UID khác vẫn cần tag — thêm hậu tố ngắn.
      const suffix = ` (${clean(s.zaloTag) || s.id.slice(-4)})`;
      const unique = label + suffix;
      prepared.push({ staff: s, label: unique, valid: isValidZaloUid(s.zaloUserId) });
      seenNames.add(unique);
      continue;
    }
    seenNames.add(label);
    prepared.push({ staff: s, label, valid: isValidZaloUid(s.zaloUserId) });
  }

  if (prepared.length > 0) {
    output += '\n👉 ';
    const base = output.length;
    let cursor = base;
    for (const item of prepared) {
      if (tagLine.length > 0) {
        output += ' ';
        cursor += 1;
      }
      output += item.label;
      if (item.valid) {
        mentions.push({ pos: cursor, len: item.label.length, uid: String(item.staff.zaloUserId).trim() });
        tagged.push(item.staff);
      } else {
        skipped.push(item.staff);
      }
      cursor += item.label.length;
      tagLine.push(item.label);
    }
  }

  return { text: output, mentions, tagged, skipped };
}

/** Payload đúng định dạng zca-js: sendMessage(content, groupId, ThreadType.Group). */
export function toZcaContent(message: ZaloMentionMessage): { msg: string; mentions: ZaloMention[] } {
  return { msg: message.text, mentions: message.mentions };
}

/** Tin nhắn kiểm tra gửi nhóm (không tag) — dùng cho nút "Test gửi nhóm". */
export function buildGroupTestText(groupName: string, at: Date | string = new Date()): string {
  const time = at instanceof Date ? at : new Date(at);
  const stamp = Number.isNaN(time.getTime())
    ? ''
    : new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(time);
  return `✅ [HARASOCIAL] Kiểm tra kết nối nhóm Zalo "${clean(groupName, 'Nhóm Zalo')}" thành công lúc ${stamp}.`;
}
