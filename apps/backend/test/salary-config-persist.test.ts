import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { SalaryConfigService } from '../src/services/salary-config.service.js';
import { GoogleSheetsSyncService, parseSystemSettingsRows } from '../src/services/google-sheets-sync.service.js';

/**
 * Cấu hình lương KHÔNG được báo "lưu thành công" khi dữ liệu không thực sự
 * tồn tại sau khi đọc lại, và không được biến mất khi một dịch vụ khác ghi đè
 * bằng snapshot cài đặt cũ.
 */

test('lương đã lưu đọc lại được từ instance mới (không mất sau reload)', async () => {
  const repo = new MockSheetsAdapter();
  const writer = new SalaryConfigService(repo as any);
  await writer.setForEmployee(
    'NV_TEST_01',
    { payMode: 'MONTHLY', baseSalary: 9_000_000, allowance: 500_000 },
    { id: 'F1', name: 'Kế toán' },
    { group: 'SALE' },
  );

  // Instance mới = mô phỏng backend khởi động lại, chỉ còn dữ liệu trong repo.
  const reader = new SalaryConfigService(repo as any);
  const got = await reader.getForEmployee('NV_TEST_01');
  assert.ok(got, 'phải đọc lại được cấu hình vừa lưu');
  assert.equal(got?.base_salary, 9_000_000);
  assert.equal(got?.allowance, 500_000);
  assert.equal(got?.pay_mode, 'MONTHLY');
});

test('snapshot cài đặt CŨ không ghi đè cấu hình lương mới hơn', async () => {
  const repo = new MockSheetsAdapter();
  const svc = new SalaryConfigService(repo as any);
  await svc.setForEmployee(
    'NV_TEST_02',
    { baseSalary: 12_000_000, allowance: 300_000 },
    { id: 'F1' },
    { group: 'VAN_PHONG' },
  );

  // Dịch vụ khác ghi lại toàn bộ settings từ snapshot cũ (updatedAt cũ hơn).
  await repo.updateSystemSettings({
    employee_salary_config: {
      NV_TEST_02: { base_salary: 1_000, allowance: 0, updatedAt: '2020-01-01T00:00:00.000Z' },
    },
    some_other_setting: 1,
  });

  const got = await svc.getForEmployee('NV_TEST_02');
  assert.equal(got?.base_salary, 12_000_000, 'bản mới hơn phải được giữ');
  assert.equal(got?.allowance, 300_000);
  // Key khác vẫn được ghi bình thường.
  const settings: any = await repo.getSystemSettings();
  assert.equal(settings.some_other_setting, 1);
});

test('ghi không thực sự lưu -> ném SALARY_CONFIG_NOT_PERSISTED (không báo thành công giả)', async () => {
  const repo: any = {
    getSystemSettings: async () => ({}),
    updateSystemSettings: async () => ({}), // nuốt lệnh ghi
    syncService: { pushSystemSettingsNow: async () => ({ ok: true, at: new Date().toISOString() }) },
  };
  const svc = new SalaryConfigService(repo);
  await assert.rejects(
    () => svc.setForEmployee('NV_TEST_03', { baseSalary: 5_000_000, allowance: 0 }),
    /SALARY_CONFIG_NOT_PERSISTED/,
  );
});

test('pushToGoogleSheets trả lỗi thật thay vì ok giả', async () => {
  const failing: any = {
    getSystemSettings: async () => ({}),
    updateSystemSettings: async () => ({}),
    syncService: {
      pushSystemSettingsNow: async () => { throw new Error('quota exceeded for CAU_HINH_HE_THONG'); },
    },
  };
  const res = await new SalaryConfigService(failing).pushToGoogleSheets();
  assert.equal(res.ok, false);
  assert.match(String(res.error), /quota exceeded/);

  const notConfigured: any = {
    getSystemSettings: async () => ({}),
    updateSystemSettings: async () => ({}),
  };
  const skipped = await new SalaryConfigService(notConfigured).pushToGoogleSheets();
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, 'SHEETS_NOT_CONFIGURED');
});

test('giá trị cài đặt quá lớn được chia phần, không làm hỏng lượt ghi cấu hình lương', async () => {
  const sync: any = Object.create(GoogleSheetsSyncService.prototype);
  sync.sheetsClient = {}; // đánh dấu đã cấu hình Sheets
  let captured: any[] = [];
  sync.overwriteSheetData = async (_tab: string, _header: any[], rows: any[]) => {
    captured = rows;
  };

  const huge = 'x'.repeat(60_000);
  const salary = { NV_TEST_04: { base_salary: 8_000_000, allowance: 200_000 } };
  const ok = await sync.syncSystemSettingsToSheet({ huge_value: huge, employee_salary_config: salary });
  assert.equal(ok, true);

  const hugeRows = captured.filter(r => String(r[0]).startsWith('huge_value::part'));
  assert.equal(hugeRows.length, 2, 'giá trị 60k ký tự phải chia thành 2 dòng');
  assert.ok(captured.every(r => String(r[1]).length <= 45_000), 'không ô nào vượt giới hạn Google');

  const salaryRow = captured.find(r => r[0] === 'employee_salary_config');
  assert.ok(salaryRow, 'cấu hình lương phải được ghi');
  assert.deepEqual(JSON.parse(String(salaryRow?.[1])), salary);

  // Pull lại phải ghép đúng nguyên vẹn giá trị lớn.
  const parsed = parseSystemSettingsRows(captured);
  assert.equal(parsed.huge_value, huge);
  assert.deepEqual(parsed.employee_salary_config, salary);
});

test('giá trị chia phần thiếu dòng bị bỏ (không đọc về dữ liệu cụt)', () => {
  const parsed = parseSystemSettingsRows([
    ['big_value::part1/2', 'nửa đầu'],
    ['employee_salary_config', '{"NV1":{"base_salary":1}}'],
  ]);
  assert.equal(parsed.big_value, undefined);
  assert.deepEqual(parsed.employee_salary_config, { NV1: { base_salary: 1 } });
});

test('cấu hình rỗng bất thường không được ghi trắng tab CAU_HINH_HE_THONG', async () => {
  const sync: any = Object.create(GoogleSheetsSyncService.prototype);
  sync.sheetsClient = {};
  let called = 0;
  sync.overwriteSheetData = async () => { called += 1; };
  const ok = await sync.syncSystemSettingsToSheet({});
  assert.equal(ok, false);
  assert.equal(called, 0, 'không được gọi ghi khi settings rỗng');
});
