import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIFORM_REFUND_MONTHS,
  UNIFORM_UNIT_PRICE,
  addMonthsClamped,
  normalizeUniformDate,
  parseUniform,
  parseUniformSizes,
  uniformCell,
  uniformPeriod,
  uniformRefundMilestoneDate,
  uniformRefundReminderDate,
  uniformRefundTotal,
  uniformSizesLabel,
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

test('parseUniform phân size L/XL: tổng số lượng = L + XL, tiền theo tổng', () => {
  const u = parseUniform({ received_date: '2026-11-12', quantity: 999, sizes: { L: 2, XL: 3 } });
  assert.equal(u?.quantity, 5, 'quantity luôn bằng L + XL khi có phân size');
  assert.deepEqual(u?.sizes, { L: 2, XL: 3 });
  assert.equal(u?.amount, 750_000);

  // Size nhận dạng chữ thường / size_L / sizeXL.
  assert.deepEqual(parseUniformSizes({ sizes: { l: 1, xl: 4 } }), { L: 1, XL: 4 });
  assert.deepEqual(parseUniformSizes({ size_L: 2, sizeXL: 1 }), { L: 2, XL: 1 });
  assert.equal(parseUniformSizes({ sizes: { L: 0, XL: 0 } }), null);
  assert.equal(parseUniformSizes({}), null);

  // Bản ghi cũ chưa phân size vẫn đọc theo quantity như trước.
  const legacy = parseUniform({ received_date: '2026-11-12', quantity: 2 });
  assert.equal(legacy?.quantity, 2);
  assert.equal(legacy?.sizes, undefined);

  // Size toàn 0 -> coi như chưa nhận (gỡ thông tin), không rơi về quantity.
  assert.equal(parseUniform({ received_date: '2026-11-12', quantity: 3, sizes: { L: 0, XL: 0 } })?.quantity, 3);
  assert.equal(parseUniform({ received_date: '2026-11-12', quantity: 0, sizes: { L: 0, XL: 0 } }), null);
});

test('uniformSizesLabel hiển thị đúng size cho Admin/NV/Kế toán', () => {
  assert.equal(uniformSizesLabel({ received_date: '2026-11-12', sizes: { L: 2, XL: 0 } }), 'L: 2');
  assert.equal(uniformSizesLabel({ received_date: '2026-11-12', sizes: { L: 2, XL: 3 } }), 'L: 2 · XL: 3');
  assert.equal(uniformSizesLabel({ received_date: '2026-11-12', quantity: 4 }), '');
  assert.equal(uniformSizesLabel(null), '');
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

test('mốc hoàn tiền = ngày nhận đồng phục + 6 tháng, nhắc HR trước 1 ngày', () => {
  assert.equal(UNIFORM_REFUND_MONTHS, 6);
  assert.equal(uniformRefundMilestoneDate('2026-05-14'), '2026-11-14');
  assert.equal(uniformRefundReminderDate('2026-05-14'), '2026-11-13');

  // Qua năm + ngày 31 kẹp về cuối tháng đích (không tràn sang tháng sau).
  assert.equal(uniformRefundMilestoneDate('2026-08-31'), '2027-02-28');
  assert.equal(uniformRefundMilestoneDate('2024-08-31'), '2025-02-28');
  assert.equal(uniformRefundMilestoneDate('2026-05-31'), '2026-11-30');

  // Ngày mốc đầu tháng -> nhắc ngày cuối tháng trước.
  assert.equal(uniformRefundReminderDate('2026-06-01'), '2026-11-30');

  // Đầu vào hỏng -> rỗng, không ném lỗi.
  assert.equal(uniformRefundMilestoneDate(''), '');
  assert.equal(uniformRefundMilestoneDate('2026-02-30'), '');
  assert.equal(addMonthsClamped('2026-13-01', 6), '');
  assert.equal(uniformRefundReminderDate('khong-phai-ngay'), '');
});

test('parseUniform đọc tiền hỗ trợ khám sức khỏe HR nhập tay', () => {
  const u = parseUniform({ received_date: '2026-11-12', quantity: 2, health_support_amount: 300000 });
  assert.equal(u?.health_support_amount, 300_000);
  assert.equal(uniformRefundTotal(u), 600_000);

  // camelCase + JSDN từ Sheet.
  assert.equal(parseUniform('{"receivedDate":"2026-11-12","quantity":1,"healthSupportAmount":"200000"}')?.health_support_amount, 200_000);

  // Không nhập / nhập 0 -> không lưu trường (tránh JSON rác).
  assert.equal(parseUniform({ received_date: '2026-11-12', quantity: 1 })?.health_support_amount, undefined);
  assert.equal(parseUniform({ received_date: '2026-11-12', quantity: 1, health_support_amount: 0 })?.health_support_amount, undefined);

  // Tổng hoàn trả = đồng phục + KSK; thiếu dữ liệu vẫn an toàn.
  assert.equal(uniformRefundTotal({ amount: 450_000, health_support_amount: 150_000 }), 600_000);
  assert.equal(uniformRefundTotal({ amount: 450_000 }), 450_000);
  assert.equal(uniformRefundTotal(null), 0);
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
  const r = await svc.saveUniform(empId, {
    received_date: '2026-11-12', quantity: 3, sizes: { L: 2, XL: 1 }, health_support_amount: 250_000,
  }, 'HR1');
  assert.equal(r.previous?.amount, 300_000);
  assert.equal(r.previous?.received_date, '2026-10-05');
  assert.equal(r.current?.amount, 450_000);
  assert.equal(r.current?.health_support_amount, 250_000);
  assert.equal(emp.uniform.quantity, 3);
  assert.deepEqual(emp.uniform.sizes, { L: 2, XL: 1 });
  assert.equal(uniformRefundTotal(emp.uniform), 700_000);
  assert.equal(audit?.action, 'UPDATE_UNIFORM');
  assert.match(String(audit?.details || ''), /450\.000/);
  assert.match(String(audit?.details || ''), /250\.000/);
  assert.match(String(audit?.details || ''), /L: 2 · XL: 1/);

  // Client cũ không gửi health_support_amount -> giữ nguyên tiền KSK đã nhập.
  const kept = await svc.saveUniform(empId, { received_date: '2026-11-12', quantity: 2 }, 'HR1');
  assert.equal(kept.current?.health_support_amount, 250_000);

  // Số lượng 0 -> gỡ thông tin đồng phục.
  const cleared = await svc.saveUniform(empId, { received_date: '', quantity: 0 }, 'HR1');
  assert.equal(cleared.current, null);
  assert.equal(cleared.previous?.quantity, 2);
  assert.equal(emp.uniform, undefined);
  assert.equal(audit?.action, 'REMOVE_UNIFORM');
});
