/**
 * Công thức tiền lương dùng chung cho Phiếu lương (Kế toán tính) và tab
 * Công/Lương của nhân viên (xem realtime số Kế toán đã nhập).
 *
 *   TỔNG CỘNG  = LCB + phụ cấp (nhập tay ghi đè, không nhập thì lấy cấu hình)
 *                + lương theo ca + OT nhập tay + thưởng nhập tay
 *   TỔNG LƯƠNG = TỔNG CỘNG − trừ KPI (nhập tay) − phạt trễ/vắng (chấm công)
 *   THỰC LÃNH  = TỔNG LƯƠNG − ứng lương − tiền đồng phục
 *
 * NV lương THÁNG không có lương theo ca/giờ (standardPay bị bỏ), chỉ LCB + phụ cấp.
 */
export interface AccountingTotalsInput {
  payMode?: string | null;
  luongCb?: number;
  allowance?: number;
  standardPay?: number;
  otExtra?: number;
  bonusExtra?: number;
  truKpi?: number;
  deduction?: number;
  ungLuong?: number;
  dongPhuc?: number;
}

export interface AccountingTotals {
  tongCong: number;
  tongLuong: number;
  thucLanh: number;
}

export function computeAccountingTotals(input: AccountingTotalsInput): AccountingTotals {
  const num = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const monthly = String(input?.payMode ?? '').trim().toUpperCase() === 'MONTHLY';
  const standardPayEff = monthly ? 0 : num(input?.standardPay);
  const tongCong = num(input?.luongCb) + num(input?.allowance) + standardPayEff + num(input?.otExtra) + num(input?.bonusExtra);
  const tongLuong = tongCong - num(input?.truKpi) - num(input?.deduction);
  const thucLanh = tongLuong - num(input?.ungLuong) - num(input?.dongPhuc);
  return { tongCong, tongLuong, thucLanh };
}
