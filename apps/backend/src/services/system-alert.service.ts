/**
 * Cảnh báo vận hành ra kênh bên ngoài (Slack / Discord / Google Chat / Telegram
 * qua webhook). Không phụ thuộc SDK, không chặn API: mọi lỗi gửi chỉ được log.
 *
 * Cấu hình:
 *   ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
 *   ALERT_TELEGRAM_CHAT_ID=...   (chỉ cần nếu dùng Telegram Bot API)
 *   ALERT_COOLDOWN_MINUTES=30    (tránh spam cùng một cảnh báo)
 *
 * Nếu không cấu hình webhook, cảnh báo vẫn được ghi ra log để watchdog/uptime
 * monitoring bên ngoài có thể bắt.
 */

import { singleWriterQueue } from '../repositories/single-writer-queue.js';

export type AlertSeverity = 'WARNING' | 'URGENT';

export interface SystemAlert {
  code: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface AlertDispatchOptions {
  webhookUrl?: string;
  cooldownMs?: number;
  /** Bỏ qua cooldown (dùng cho sự kiện nghiêm trọng như backup fail). */
  force?: boolean;
  fetchImpl?: typeof fetch;
}

const DEFAULT_COOLDOWN_MS = 30 * 60_000;
const lastSentAt = new Map<string, number>();

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hostLabel(): string {
  return process.env.HOSTNAME || process.env.COMPUTERNAME || 'ubm-server';
}

/** Thu thập các bất thường hiện tại. Hàm thuần, dễ test. */
export function collectSystemAlerts(adapter: any, now = Date.now()): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  const status = adapter?.getStatus?.() || {};
  const readiness = adapter?.getReadiness?.() || { ready: true };
  const syncStatus = adapter?.syncService?.getStatus?.() || status.syncService || {};
  const mode = String(status.mode || 'UNKNOWN');
  const isProduction = process.env.NODE_ENV === 'production';
  const isLive = mode === 'GOOGLE_SHEETS_LIVE';

  const lastPulledMs = syncStatus?.lastPulledAt ? Date.parse(syncStatus.lastPulledAt) : NaN;
  const lagMs = Number.isFinite(lastPulledMs) ? Math.max(0, now - lastPulledMs) : null;
  const syncIntervalMs = readPositiveNumber(process.env.SHEETS_SYNC_INTERVAL_MS, 5_000);
  const staleAfterMs = Math.max(syncIntervalMs * 6, 120_000);

  if (isProduction && !isLive) {
    alerts.push({
      code: 'SHEETS_MOCK_ENGINE_IN_PRODUCTION',
      severity: 'URGENT',
      title: '🚨 Production đang chạy mock engine',
      message:
        'Không có kết nối Google Sheets ở môi trường production. Dữ liệu chỉ nằm trong bộ nhớ và có thể mất khi restart. Kiểm tra GOOGLE_SERVICE_ACCOUNT_JSON / SPREADSHEET_ID ngay.',
      details: { mode, host: hostLabel() },
    });
  }

  if (readiness.ready === false) {
    alerts.push({
      code: readiness.reason || 'SHEETS_NOT_READY',
      severity: 'URGENT',
      title: '🚨 Google Sheets chưa sẵn sàng',
      message: `Hệ thống chưa đọc được dữ liệu Google Sheets (${readiness.reason || 'NOT_READY'}). Đăng nhập và đồng bộ có thể bị ảnh hưởng.`,
      details: { reason: readiness.reason || null, host: hostLabel() },
    });
  }

  if (isLive && (lagMs === null || lagMs > staleAfterMs)) {
    alerts.push({
      code: 'SHEETS_SYNC_STALE',
      severity: 'WARNING',
      title: '⚠️ Đồng bộ Google Sheets bị chậm',
      message:
        lagMs === null
          ? 'Chưa có lần pull Google Sheets nào kể từ khi khởi động.'
          : `Lần pull Google Sheets gần nhất cách đây ${Math.round(lagMs / 1000)} giây (ngưỡng ${Math.round(staleAfterMs / 1000)} giây).`,
      details: { lastPulledAt: syncStatus?.lastPulledAt || null, lagMs, staleAfterMs, host: hostLabel() },
    });
  }

  const pendingWrites = singleWriterQueue.getPendingCount();
  if (pendingWrites > 500) {
    alerts.push({
      code: 'WRITE_QUEUE_BACKLOG',
      severity: 'URGENT',
      title: '🚨 Hàng đợi ghi Google Sheets bị kẹt',
      message: `Có ${pendingWrites} thao tác đang chờ ghi lên Google Sheets. Kiểm tra quota/API hoặc lỗi mạng.`,
      details: { pendingWrites, host: hostLabel() },
    });
  }

  return alerts;
}

function buildWebhookPayload(alerts: SystemAlert[], now: number) {
  const text = [
    `[UBM HR] ${alerts.length} cảnh báo vận hành — ${new Date(now).toISOString()}`,
    `Host: ${hostLabel()}`,
    '',
    ...alerts.map(a => `${a.severity === 'URGENT' ? '🚨' : '⚠️'} ${a.title}\n${a.message}`),
  ].join('\n');

  const payload: Record<string, unknown> = {
    // `text` cho Slack/Google Chat, `content` cho Discord.
    text,
    content: text,
    alerts,
    timestamp: new Date(now).toISOString(),
    host: hostLabel(),
  };
  const telegramChatId = process.env.ALERT_TELEGRAM_CHAT_ID;
  if (telegramChatId) payload.chat_id = telegramChatId;
  return payload;
}

/**
 * Gửi cảnh báo, có cooldown theo `code` để không spam. Trả về số cảnh báo đã gửi.
 * Không bao giờ ném lỗi ra ngoài.
 */
export async function dispatchSystemAlerts(
  alerts: SystemAlert[],
  options: AlertDispatchOptions = {},
): Promise<number> {
  if (!alerts.length) return 0;

  const now = Date.now();
  const cooldownMs = options.cooldownMs ?? readPositiveNumber(process.env.ALERT_COOLDOWN_MINUTES, DEFAULT_COOLDOWN_MS / 60_000) * 60_000;
  const pending = options.force
    ? alerts
    : alerts.filter(a => now - (lastSentAt.get(a.code) || 0) >= cooldownMs);
  if (!pending.length) return 0;

  const webhookUrl = options.webhookUrl ?? process.env.ALERT_WEBHOOK_URL;
  const text = buildWebhookPayload(pending, now);

  if (!webhookUrl) {
    console.warn('[system-alert]', JSON.stringify(text));
    for (const alert of pending) lastSentAt.set(alert.code, now);
    return 0;
  }

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(text),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    for (const alert of pending) lastSentAt.set(alert.code, now);
    console.log(`[system-alert] Đã gửi ${pending.length} cảnh báo: ${pending.map(a => a.code).join(', ')}`);
    return pending.length;
  } catch (err: any) {
    // Không đánh dấu đã gửi để lần tick sau thử lại.
    console.error('[system-alert] Gửi webhook thất bại:', err?.message || err);
    return 0;
  }
}

/** Gửi ngay một cảnh báo (dùng cho backup fail, lỗi không theo chu kỳ). */
export async function notifySystemAlert(
  alert: SystemAlert,
  options: AlertDispatchOptions = {},
): Promise<number> {
  return dispatchSystemAlerts([alert], { ...options, force: true });
}

export interface AlertMonitorOptions extends AlertDispatchOptions {
  intervalMs?: number;
  initialDelayMs?: number;
}

/**
 * Chạy nền: kiểm tra mỗi 5 phút, gửi cảnh báo khi có bất thường.
 * Trả về hàm stop() để tắt êm khi shutdown.
 */
export function startSystemAlertMonitor(
  adapter: any,
  options: AlertMonitorOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? 5 * 60_000;
  const initialDelayMs = options.initialDelayMs ?? 60_000;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    try {
      const alerts = collectSystemAlerts(adapter);
      if (alerts.length > 0) void dispatchSystemAlerts(alerts, options);
    } catch (err: any) {
      console.warn('[system-alert] tick error:', err?.message || err);
    }
  };

  const initialTimer = setTimeout(tick, initialDelayMs);
  initialTimer.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(timer);
  };
}
