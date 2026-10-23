import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsSyncService } from '../src/services/google-sheets-sync.service.js';

test('watchdog giải phóng pull treo quá 20 phút để tick sau pull lại', () => {
  const svc = new GoogleSheetsSyncService();
  (svc as any).pullInFlight = new Promise(() => { /* treo vô hạn */ });
  (svc as any).pullStartedAt = Date.now() - 21 * 60_000;

  assert.equal(svc.ensurePullNotStuck(), true);
  assert.equal((svc as any).pullInFlight, null);
  // Lần gọi kế tiếp không còn gì để giải phóng.
  assert.equal(svc.ensurePullNotStuck(), false);
});

test('watchdog không can thiệp pull mới đang chạy', () => {
  const svc = new GoogleSheetsSyncService();
  (svc as any).pullInFlight = new Promise(() => {});
  (svc as any).pullStartedAt = Date.now() - 60_000;

  assert.equal(svc.ensurePullNotStuck(), false);
  assert.notEqual((svc as any).pullInFlight, null);
});
