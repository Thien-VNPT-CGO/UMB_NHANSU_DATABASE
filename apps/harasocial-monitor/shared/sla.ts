/** Đánh giá SLA & nhịp nhắc lặp — logic thuần. */
import type { SlaConfig, SlaDecision } from './types';

export interface SlaConversationInput {
  lastSender: 'customer' | 'staff' | string;
  status: 'replied' | 'waiting' | 'missed' | string;
  alertSentForCurrentTurn: boolean;
  alertCount: number;
  lastCustomerMessageAt: string | Date | null;
  lastAlertSentAt?: string | Date | null;
}

function toMs(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function safeThreshold(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Quyết định lần quét SLA:
 * - Lần 1 khi chờ >= ngưỡng SLA.
 * - Nhắc lại mỗi `repeatIntervalMinutes` phút SAU mốc SLA
 *   (ví dụ SLA 5', nhắc 2' => 7', 9', 11'...).
 * - repeatIntervalMinutes <= 0 => tắt nhắc lặp.
 * Trả về action 'none' khi khách đã được trả lời hoặc chưa tới hạn.
 */
export function evaluateSla(
  conversation: SlaConversationInput,
  config: SlaConfig,
  now: Date | string | number = new Date()
): SlaDecision {
  const threshold = safeThreshold(Number(config.thresholdMinutes), 5);
  const interval = safeThreshold(Number(config.repeatIntervalMinutes), 0);
  const nowMs = toMs(now as any);
  const customerMs = toMs(conversation.lastCustomerMessageAt);


  if (nowMs === null || customerMs === null) {
    return { action: 'none', alertCount: Math.max(0, Math.floor(Number(conversation.alertCount) || 0)), waitedMinutes: 0, nextRepeatAtMinutes: null };
  }
  if (conversation.lastSender !== 'customer') {
    return { action: 'none', alertCount: Math.max(0, Math.floor(Number(conversation.alertCount) || 0)), waitedMinutes: 0, nextRepeatAtMinutes: null };
  }
  if (conversation.status === 'replied') {
    return { action: 'none', alertCount: 0, waitedMinutes: 0, nextRepeatAtMinutes: null };
  }

  const waitedMinutes = Math.max(0, Math.floor((nowMs - customerMs) / 60_000));
  const currentCount = Math.max(0, Math.floor(Number(conversation.alertCount) || 0));

  if (!conversation.alertSentForCurrentTurn) {
    if (waitedMinutes >= threshold) {
      return {
        action: 'first',
        alertCount: 1,
        waitedMinutes,
        nextRepeatAtMinutes: interval > 0 ? threshold + interval : null,
      };
    }
    return { action: 'none', alertCount: currentCount, waitedMinutes, nextRepeatAtMinutes: null };
  }

  if (interval <= 0) {
    return { action: 'none', alertCount: Math.max(1, currentCount), waitedMinutes, nextRepeatAtMinutes: null };
  }

  // Chống bắn trùng do worker tick dày hơn chu kỳ nhắc.
  const lastAlertMs = toMs(conversation.lastAlertSentAt);
  if (lastAlertMs !== null && nowMs - lastAlertMs < interval * 60_000) {
    const next = threshold + interval * Math.max(1, currentCount);
    return { action: 'none', alertCount: Math.max(1, currentCount), waitedMinutes, nextRepeatAtMinutes: next };
  }

  const count = Math.max(1, currentCount);
  const nextDue = threshold + interval * count;
  if (waitedMinutes >= nextDue) {
    return {
      action: 'repeat',
      alertCount: count + 1,
      waitedMinutes,
      nextRepeatAtMinutes: threshold + interval * (count + 1),
    };
  }

  return { action: 'none', alertCount: count, waitedMinutes, nextRepeatAtMinutes: nextDue };
}

/** Phút phản hồi thực tế (làm tròn), null nếu thiếu mốc thời gian. */
export function computeResponseMinutes(
  customerAt: string | Date | null | undefined,
  replyAt: string | Date | null | undefined
): number | null {
  const c = toMs(customerAt ?? null);
  const r = toMs(replyAt ?? null);
  if (c === null || r === null) return null;
  return Math.max(0, Math.round((r - c) / 60_000));
}

/** Nhãn mô tả nhịp nhắc để hiển thị trên UI. */
export function repeatLabel(thresholdMinutes: number, intervalMinutes: number): string {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return `Cảnh báo 1 lần khi quá ${thresholdMinutes} phút`;
  }
  return `Cảnh báo lần 1 sau ${thresholdMinutes} phút, nhắc lại mỗi ${intervalMinutes} phút`;
}
