import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAccountingTotals } from '@ubm/shared';

/**
 * Công thức tiền lương dùng chung giữa Phiếu lương (Kế toán) và tab Công/Lương
 * ở cổng nhân viên. Test khóa lại để 2 màn hình không bao giờ lệch số.
 */
test('lương ca: tổng cộng → tổng lương → thực lãnh', () => {
  const t = computeAccountingTotals({
    payMode: 'SHIFT',
    luongCb: 0,
    allowance: 200_000,
    standardPay: 4_000_000,
    otExtra: 0,
    bonusExtra: 300_000,
    truKpi: 100_000,
    deduction: 50_000,
    ungLuong: 500_000,
    dongPhuc: 150_000,
  });
  assert.equal(t.tongCong, 4_500_000);
  assert.equal(t.tongLuong, 4_350_000);
  assert.equal(t.thucLanh, 3_700_000);
});

test('lương tháng: bỏ tiền theo ca, chỉ LCB + phụ cấp', () => {
  const t = computeAccountingTotals({
    payMode: 'MONTHLY',
    luongCb: 8_000_000,
    allowance: 500_000,
    standardPay: 9_999_999, // lương tháng không cộng tiền ca
    bonusExtra: 0,
    truKpi: 0,
    deduction: 0,
  });
  assert.equal(t.tongCong, 8_500_000);
  assert.equal(t.thucLanh, 8_500_000);
});

test('Sale 4 ca/ngày: số Kế toán nhập khớp đúng từng nhân viên', () => {
  // Sale ca 4h, đơn giá 30.000đ/h → 10 ca = 40h = 1.200.000đ
  const t = computeAccountingTotals({
    payMode: 'SHIFT',
    standardPay: 40 * 30_000,
    allowance: 0,
    bonusExtra: 200_000,
    truKpi: 0,
    deduction: 0,
    ungLuong: 0,
    dongPhuc: 150_000,
  });
  assert.equal(t.tongCong, 1_400_000);
  assert.equal(t.thucLanh, 1_250_000);
});

test('ô trống/âm được coi là 0, không làm âm lương', () => {
  const t = computeAccountingTotals({
    payMode: 'SHIFT',
    standardPay: 1_000_000,
    truKpi: -500 as any,
    ungLuong: null as any,
  });
  assert.equal(t.tongCong, 1_000_000);
  assert.equal(t.tongLuong, 1_000_000);
  assert.equal(t.thucLanh, 1_000_000);
});
