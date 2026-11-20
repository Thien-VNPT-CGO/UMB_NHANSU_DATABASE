import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeResponseMinutes, evaluateSla, repeatLabel } from '../shared/sla';

const BASE = Date.parse('2026-06-01T10:00:00Z');
const at = (minutes: number) => new Date(BASE + minutes * 60_000);

function conv(overrides: Record<string, unknown> = {}) {
  return {
    lastSender: 'customer',
    status: 'waiting',
    alertSentForCurrentTurn: false,
    alertCount: 0,
    lastCustomerMessageAt: new Date(BASE).toISOString(),
    lastAlertSentAt: null,
    ...overrides,
  } as any;
}

const CONFIG = { thresholdMinutes: 5, repeatIntervalMinutes: 2 };

test('chưa tới ngưỡng SLA => chưa cảnh báo', () => {
  const result = evaluateSla(conv(), CONFIG, at(4));
  assert.equal(result.action, 'none');
  assert.equal(result.waitedMinutes, 4);
});

test('đúng ngưỡng SLA 5 phút => cảnh báo lần 1, hẹn nhắc 7 phút', () => {
  const result = evaluateSla(conv(), CONFIG, at(5));
  assert.equal(result.action, 'first');
  assert.equal(result.alertCount, 1);
  assert.equal(result.nextRepeatAtMinutes, 7);
});

test('nhắc lại mỗi 2 phút sau mốc SLA', () => {
  const alerted = conv({
    status: 'missed',
    alertSentForCurrentTurn: true,
    alertCount: 1,
    lastAlertSentAt: at(5).toISOString(),
  });
  assert.equal(evaluateSla(alerted, CONFIG, at(6)).action, 'none');
  const r7 = evaluateSla(alerted, CONFIG, at(7));
  assert.equal(r7.action, 'repeat');
  assert.equal(r7.alertCount, 2);
  assert.equal(r7.nextRepeatAtMinutes, 9);
});

test('lần nhắc thứ 3 tại phút 9 và chặn bắn trùng trong 2 phút', () => {
  const alerted = conv({
    status: 'missed',
    alertSentForCurrentTurn: true,
    alertCount: 2,
    lastAlertSentAt: at(7).toISOString(),
  });
  assert.equal(evaluateSla(alerted, CONFIG, at(8)).action, 'none');
  const r9 = evaluateSla(alerted, CONFIG, at(9));
  assert.equal(r9.action, 'repeat');
  assert.equal(r9.alertCount, 3);
});

test('tắt nhắc lặp (0 phút) => chỉ cảnh báo 1 lần', () => {
  const alerted = conv({ status: 'missed', alertSentForCurrentTurn: true, alertCount: 1 });
  assert.equal(evaluateSla(alerted, { thresholdMinutes: 5, repeatIntervalMinutes: 0 }, at(30)).action, 'none');
  assert.equal(repeatLabel(5, 0), 'Cảnh báo 1 lần khi quá 5 phút');
});

test('đã trả lời hoặc tin cuối là staff => reset/không cảnh báo', () => {
  assert.equal(evaluateSla(conv({ status: 'replied' }), CONFIG, at(30)).action, 'none');
  assert.equal(evaluateSla(conv({ lastSender: 'staff' }), CONFIG, at(30)).action, 'none');
  assert.equal(evaluateSla(conv({ status: 'replied' }), CONFIG, at(30)).alertCount, 0);
});

test('thiếu mốc thời gian hoặc thời gian tương lai => an toàn', () => {
  assert.equal(evaluateSla(conv({ lastCustomerMessageAt: null }), CONFIG, at(30)).action, 'none');
  const future = evaluateSla(conv({ lastCustomerMessageAt: at(10).toISOString() }), CONFIG, at(0));
  assert.equal(future.action, 'none');
  assert.equal(future.waitedMinutes, 0);
});

test('computeResponseMinutes làm tròn phút phản hồi', () => {
  assert.equal(computeResponseMinutes(at(0), at(3)), 3);
  assert.equal(computeResponseMinutes(at(0), at(0.6)), 1);
  assert.equal(computeResponseMinutes(null, at(3)), null);
  assert.equal(computeResponseMinutes(at(5), at(1)), 0);
});
