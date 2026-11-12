import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIFORM_UNIT_PRICE,
  normalizeUniformDate,
  parseUniform,
  uniformCell,
  uniformPeriod,
} from '../src/utils/uniform.js';
import { EmployeesService } from '../src/services/employees.service.js';

test('đơn giá đồng phục chuẩn là 150.000đ/áo', () => {
  assert.equal(UNIFORM_UNIT_PRICE, 150_000);
});

test('normalizeUniformDate chuẩn hóa ISO, DD/MM/YYYY và rỗng an toàn', () => {
  assert.equal(normalizeUniformDate('2026-11-12'), '2026-11-12');
  assert.equal(normalizeUniformDate('2026-11-12T10:30:00.000Z'), '2026-11-12');
  assert.equal(normalizeUniformDate('12/11/2026'), '2026-11-12');
  assert.equal(normalizeUniformDate('1-2-2026'), '2026-02-01');
  assert.equal(normalizeUniformDate(''), '');
  assert.equal(normalizeUniformDate(null), '');
  assert.equal(normalizeUniformDate('khong-phai-ngay'), '');
});

test('parseUniform tính thành tiền = số lượng × đơn giá, mặc định 150.000đ', () => {
  const u = parseUniform({ received_date: '2026-11-12', quantity: 3 });
  assert.equal(u?.received_date, '2026-11-12');
  assert.equal(u?.quantity, 3);
  assert.equal(u?.unit_price, 150_000);
  assert.equal(u?.amount, 450_000);

  // Số lượng tăng -> tiền tăng theo.
  assert.equal(parseUniform({ received_date: '2026-11-12', quantity: 5 })?.amount, 750_000);

  // Nhận object/chuỗi JSON/camelCase.
  assert.equal(parseUniform(JSON.stringify({ receivedDate: '12/11/2026', quantity: 2 }))?.amount, 300_000);

  // Thiếu ngày hoặc số lượng <= 0 -> coi như chưa có (gỡ thông tin).
  assert.equal(parseUniform({ quantity: 3 }), null);
  assert.equal(parseUniform({ received_date: '2026-11-12', quantity: 0 }), null);
  assert.equal(parseUniform({ received_date: '2026-11-12', quantity: -2 }), null);
  assert.equal(parseUniform(''), null);
  assert.equal(parseUniform('{hong'), null);
});

test('uniformCell phát JSON gọn và rỗng khi chưa có dữ liệu', () => {
  assert.equal(uniformCell(undefined), '');
  assert.equal(uniformCell({}), '');
  const cell = uniformCell({ received_date: '2026-11-12', quantity: 4 });
  assert.equal(JSON.parse(cell).quantity, 4);
  assert.equal(JSON.parse(cell).amount, 600_000);
  assert.equal(parseUniform(cell)?.received_date, '2026-11-12');
});

test('uniformPeriod trả kỳ lương YYYY-MM của ngày nhận', () => {
  assert.equal(uniformPeriod('2026-11-12'), '2026-11');
  assert.equal(uniformPeriod('12/11/2026'), '2026-11');
  assert.equal(uniformPeriod(''), '');
});

test('saveUniform: HR nhập số lượng -> lưu hồ sơ + trả bản ghi trước để Kế toán dọn tháng cũ', async () => {
  const empId = `TEST_UNIFORM_${Date.now()}`;
  const emp: any = {
    employee_id: empId,
    employee_code: 'NV_DP',
    full_name: 'Nguyễn Đồng Phục',
    version: 1,
    uniform: {
      received_date: '2026-10-05', quantity: 2, unit_price: 150000, amount: 300000,
      updated_at: '2026-10-05T00:00:00.000Z', updated_by: 'HR1',
    },
  };
  let audit: any = null;
  const repo: any = {
    getEmployeeById: async () => emp,
    updateEmployee: async (_id: string, patch: any, _v?: number) => { Object.assign(emp, patch); emp.version += 1; return emp; },
    recordAuditLog: async (log: any) => { audit = log; },
  };
  const svc = new EmployeesService(repo);
  const r = await svc.saveUniform(empId, { received_date: '2026-11-12', quantity: 3 }, 'HR1');
  assert.equal(r.previous?.amount, 300_000);
  assert.equal(r.previous?.received_date, '2026-10-05');
  assert.equal(r.current?.amount, 450_000);
  assert.equal(emp.uniform.quantity, 3);
  assert.equal(audit?.action, 'UPDATE_UNIFORM');
  assert.match(String(audit?.details || ''), /450\.000/);

  // Số lượng 0 -> gỡ thông tin đồng phục.
  const cleared = await svc.saveUniform(empId, { received_date: '', quantity: 0 }, 'HR1');
  assert.equal(cleared.current, null);
  assert.equal(cleared.previous?.quantity, 3);
  assert.equal(emp.uniform, undefined);
  assert.equal(audit?.action, 'REMOVE_UNIFORM');
});
