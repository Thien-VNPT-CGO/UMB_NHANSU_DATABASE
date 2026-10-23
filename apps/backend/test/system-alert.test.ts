import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSystemAlerts } from '../src/services/system-alert.service.js';

function fakeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    getStatus: () => ({ mode: 'GOOGLE_SHEETS_LIVE', connected: true }),
    getReadiness: () => ({ ready: true }),
    syncService: {
      getStatus: () => ({ lastPulledAt: new Date(Date.now() - 5_000).toISOString() }),
    },
    ...overrides,
  };
}

test('production chạy mock engine -> cảnh báo URGENT', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const adapter = fakeAdapter({
      getStatus: () => ({ mode: 'MOCK_ENGINE_ACTIVE', connected: false }),
      syncService: { getStatus: () => ({ lastPulledAt: null }) },
    });
    const alerts = collectSystemAlerts(adapter, Date.now());
    assert.ok(alerts.some(a => a.code === 'SHEETS_MOCK_ENGINE_IN_PRODUCTION'));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('Sheets live nhưng pull quá cũ -> cảnh báo sync stale', () => {
  const now = Date.now();
  const adapter = fakeAdapter({
    syncService: {
      getStatus: () => ({ lastPulledAt: new Date(now - 10 * 60_000).toISOString() }),
    },
  });
  const alerts = collectSystemAlerts(adapter, now);
  assert.ok(alerts.some(a => a.code === 'SHEETS_SYNC_STALE'));
});

test('Sheets live + pull mới + không kẹt queue -> không cảnh báo', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const alerts = collectSystemAlerts(fakeAdapter(), Date.now());
    assert.deepEqual(alerts, []);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('readiness thất bại -> cảnh báo theo lý do', () => {
  const adapter = fakeAdapter({
    getReadiness: () => ({ ready: false, reason: 'SHEETS_UNREACHABLE' }),
  });
  const alerts = collectSystemAlerts(adapter, Date.now());
  assert.ok(alerts.some(a => a.code === 'SHEETS_UNREACHABLE'));
});
