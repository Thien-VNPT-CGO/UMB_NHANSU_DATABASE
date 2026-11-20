import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import {
  HrScheduleWebhookService,
  formatShiftRange,
} from '../src/services/hr-schedule-webhook.service.js';

const DATE = '2026-08-03';

function employee(overrides: Record<string, any> = {}) {
  return {
    employee_id: 'EMP_SALE_1',
    employee_code: 'S001',
    full_name: 'Nguyễn Văn Sale',
    email: 'sale1@example.com',
    group: 'SALE',
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN1',
    version: 1,
    ...overrides,
  } as any;
}

function shift(overrides: Record<string, any> = {}) {
  return {
    assignment_id: 'A1',
    employee_id: 'EMP_SALE_1',
    branch_id: 'CN1',
    shift_code: 'CA_1',
    date: DATE,
    start_at: `${DATE}T00:00:00.000Z`, // 07:00 VN
    end_at: `${DATE}T04:00:00.000Z`,   // 11:00 VN
    status: 'PUBLISHED',
    schedule_version: 1,
    created_at: `${DATE}T00:00:00.000Z`,
    updated_at: `${DATE}T00:00:00.000Z`,
    ...overrides,
  } as any;
}

test('formatShiftRange: đổi mốc UTC sang giờ Việt Nam "HH:MM - HH:MM"', () => {
  assert.equal(formatShiftRange(shift(), 'SALE'), '07:00 - 11:00');
  assert.equal(
    formatShiftRange({ date: DATE, shift_code: 'CA_3', start_at: '', end_at: '' }, 'SALE'),
    '15:00 - 19:00'
  );
});

test('notifyDay: gửi đúng payload + header x-hr-secret, gộp nhiều ca trong ngày', async () => {
  process.env.HR_SCHEDULE_WEBHOOK_URL = 'https://example.test/api/webhooks/hr-schedule?workspace=ws';
  process.env.HR_SCHEDULE_WEBHOOK_SECRET = 'hr_test_secret';
  process.env.HR_SCHEDULE_WEBHOOK_ENABLED = '1';

  const repo = new MockSheetsAdapter();
  repo.employees = [employee()];
  repo.shifts = [
    shift(),
    shift({
      assignment_id: 'A2',
      shift_code: 'CA_3',
      start_at: `${DATE}T08:00:00.000Z`, // 15:00 VN
      end_at: `${DATE}T12:00:00.000Z`,   // 19:00 VN
    }),
  ];

  const calls: Array<{ url: string; headers: any; body: any }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init?.headers, body: JSON.parse(String(init?.body || '{}')) });
    return new Response('{"ok":true}', { status: 200 });
  }) as any;

  try {
    const sent = await new HrScheduleWebhookService(repo).notifyDay('EMP_SALE_1', DATE);
    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['x-hr-secret'], 'hr_test_secret');
    assert.deepEqual(calls[0].body, {
      employeeId: 'EMP_SALE_1',
      fullName: 'Nguyễn Văn Sale',
      email: 'sale1@example.com',
      shift: '07:00 - 11:00, 15:00 - 19:00',
      active: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('notifyDay: ngày không còn ca → active=false, dùng ca vừa xoá làm giờ dự phòng', async () => {
  process.env.HR_SCHEDULE_WEBHOOK_URL = 'https://example.test/api/webhooks/hr-schedule?workspace=ws';
  process.env.HR_SCHEDULE_WEBHOOK_SECRET = 'hr_test_secret';
  process.env.HR_SCHEDULE_WEBHOOK_ENABLED = '1';

  const repo = new MockSheetsAdapter();
  repo.employees = [employee()];
  repo.shifts = [];

  const bodies: any[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    bodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    await new HrScheduleWebhookService(repo).notifyDay('EMP_SALE_1', DATE, {
      fallbackAssignment: { date: DATE, shift_code: 'CA_2' },
    });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].active, false);
    assert.equal(bodies[0].shift, '11:00 - 15:00');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('endpoint trả trang HTML "Cookie check" (HTTP 200) → coi là thất bại', async () => {
  process.env.HR_SCHEDULE_WEBHOOK_URL = 'https://ais-dev.example.run.app/api/webhooks/hr-schedule';
  process.env.HR_SCHEDULE_WEBHOOK_SECRET = 'hr_test_secret';
  process.env.HR_SCHEDULE_WEBHOOK_ENABLED = '1';

  const repo = new MockSheetsAdapter();
  repo.employees = [employee()];
  repo.shifts = [shift()];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('<!doctype html><html><title>Cookie check</title></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })) as any;
  try {
    const sent = await new HrScheduleWebhookService(repo).notifyDay('EMP_SALE_1', DATE);
    assert.equal(sent, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook chưa cấu hình → bỏ qua, không gọi fetch', async () => {
  delete process.env.HR_SCHEDULE_WEBHOOK_URL;
  delete process.env.HR_SCHEDULE_WEBHOOK_SECRET;
  process.env.HR_SCHEDULE_WEBHOOK_ENABLED = '1';

  const repo = new MockSheetsAdapter();
  repo.employees = [employee()];
  repo.shifts = [shift()];

  let called = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { called += 1; return new Response('{}'); }) as any;
  try {
    const sent = await new HrScheduleWebhookService(repo).notifyDay('EMP_SALE_1', DATE);
    assert.equal(sent, false);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
