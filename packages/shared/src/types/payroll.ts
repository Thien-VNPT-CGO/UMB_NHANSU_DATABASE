export type PayrollRunStatus = 'DRAFT' | 'RECONCILED' | 'APPROVED' | 'PUBLISHED' | 'PAID' | 'CONFIRMED';

export interface PayrollRun {
  run_id: string;
  period: string; // YYYY-MM
  branch_scope: string; // 'ALL' or specific branch
  status: PayrollRunStatus;
  total_employees: number;
  total_hours: number;
  total_amount: number;
  created_by: string; // Finance creator
  reconciled_by?: string;
  reconciled_at?: string;
  approved_by?: string; // Must be different from created_by (PAYROLL_APPROVER)
  approved_at?: string;
  published_by?: string;
  published_at?: string;
  paid_by?: string;
  paid_at?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Chữ ký điện tử trên phiếu lương (vẽ tay): tên + thời điểm + ảnh PNG dataURL. */
export interface PayslipSignature {
  name: string;
  at: string;
  /** Ảnh chữ ký (dataURL PNG, đã nén kích thước ký số). */
  img?: string;
  by?: string;
}

export type PayslipSignerRole = 'lap' | 'quanly' | 'nhanvien';

export interface PayslipItem {
  item_id: string;
  run_id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  period: string;
  total_shifts: number;
  /** Số ca vắng không lương (qua 3h không check-in, có/không bản ghi ABSENT). */
  absent_shifts?: number;
  standard_hours: number;
  rate_snapshot: number; // VND per hour
  standard_pay: number;
  /** Giờ công giai đoạn thử việc trong kỳ (NV chuyển chính thức giữa kỳ). */
  tv_hours?: number;
  /** Lương giờ giai đoạn thử việc trong kỳ. */
  tv_pay?: number;
  /** Giờ công giai đoạn chính thức trong kỳ. */
  ct_hours?: number;
  /** Lương giờ giai đoạn chính thức trong kỳ. */
  ct_pay?: number;
  /** Legacy: đã bỏ phụ cấp, luôn ghi 0 (giữ trường để đọc phiếu cũ). */
  allowance: number;
  bonus: number;
  deduction: number;
  net_pay: number;
  // --- Mở rộng theo file Excel lương (Payment/BCC): các trường optional để
  // phiếu cũ vẫn đọc được, phiếu mới tính theo công thức có đủ breakdown.
  /** Legacy: đã bỏ phụ cấp OT, luôn ghi 0. */
  ot_slots?: number;
  /** Legacy: đã bỏ phụ cấp tăng ca, luôn ghi 0. */
  phu_cap_ot?: number;
  /** Lương CB nhập tay theo kỳ (Excel cột H). */
  luong_cb?: number;
  /** Tiền OT thêm nhập tay theo kỳ (Excel cột K). */
  ot_extra?: number;
  /** Bonus thêm nhập tay theo kỳ (Excel cột AW trong BCC). */
  bonus_extra?: number;
  /** Ứng lương nhập tay theo kỳ (Excel cột O). */
  ung_luong?: number;
  /** Trừ KPI nhập tay theo kỳ (Excel cột N). */
  tru_kpi?: number;
  /** Trừ đồng phục nhập tay theo kỳ (Excel cột P). */
  dong_phuc?: number;
  /** TỔNG CỘNG = luong_cb + standard_pay + ot_extra + bonus (Excel M, đã bỏ phụ cấp). */
  tong_cong?: number;
  /** TỔNG LƯƠNG = tong_cong - tru_kpi - deduction (Excel Q). */
  tong_luong?: number;
  /** THỰC LÃNH = tong_luong - ung_luong - dong_phuc (Excel R). */
  thuc_lanh?: number;
  // --- Quy trình ký 3 bên + phát hành từng phiếu (DRAFT -> PUBLISHED -> CONFIRMED -> PAID) ---
  /** Chữ ký người lập phiếu (Kế toán). Đủ 2 ký lập+quản lý mới hiện nút PUBLISHED. */
  sign_lap?: PayslipSignature;
  /** Chữ ký quản lý chi nhánh. */
  sign_quanly?: PayslipSignature;
  /** Chữ ký xác nhận của nhân viên (chỉ ký khi phiếu đã PUBLISHED). */
  sign_nhanvien?: PayslipSignature;
  /** Thời điểm gửi phiếu đến nhân viên. */
  slip_published_at?: string;
  /** Thời điểm nhân viên ký xác nhận. */
  slip_confirmed_at?: string;
  /** Thời điểm kế toán xác nhận đã chuyển khoản. */
  slip_paid_at?: string;
  slip_paid_by?: string;
  bank_name?: string;
  bank_account?: string;
  bank_holder?: string;
  status: PayrollRunStatus;
  created_at: string;
  updated_at: string;
}

/** Cấu hình tài khoản nhận lương công ty để sinh VietQR động theo số thực lãnh từng NV. */
export interface BankQrConfig {
  /** Mã ngân hàng VietQR (VD: VCB, TCB, ACB...). */
  bank: string;
  /** Số tài khoản công ty. */
  account: string;
  /** Tên chủ tài khoản. */
  holder: string;
  updatedBy?: string;
  updatedAt?: string;
}

/** URL ảnh VietQR động: đúng số tiền thực lãnh + nội dung = mã NV + kỳ lương. */
export function vietQrUrl(cfg: BankQrConfig, amount: number, info: string): string {
  const amt = Math.max(0, Math.round(Number(amount) || 0));
  const p = new URLSearchParams({
    amount: String(amt),
    addInfo: info.slice(0, 50),
    accountName: (cfg.holder || '').slice(0, 50),
  });
  return `https://img.vietqr.io/image/${encodeURIComponent(cfg.bank)}-${encodeURIComponent(cfg.account)}-compact2.png?${p.toString()}`;
}

/**
 * Công thức tính lương 1 kỳ (lưu từ file Excel lương của Kế toán):
 * TỔNG CỘNG = luong_cb + luong_gio + ot_extra + bonus (đã bỏ phụ cấp)
 * TỔNG LƯƠNG = TỔNG CỘNG − tru_kpi − phạt trễ/vắng
 * THỰC LÃNH = TỔNG LƯƠNG − ung_luong − dong_phuc
 */
export interface PayrollFormula {
  period: string; // YYYY-MM
  /** Đơn giá giờ thử việc (Excel TV 21K, mặc định 21000). */
  rateTV: number;
  /** Đơn giá giờ chính thức (Excel CT 25.5K/30K, mặc định 25500). */
  rateCT: number;
  /** Legacy: đã bỏ phụ cấp OT, luôn 0. */
  otPerSlot: number;
  /** Ngưỡng giờ/ngày để đếm ngày tăng ca 1 (Excel 10). */
  otThreshold1: number;
  /** Ngưỡng giờ/ngày để đếm ngày tăng ca 2 (Excel 15). */
  otThreshold2: number;
  updatedBy?: string;
  updatedAt?: string;
}

/** Dữ liệu nhập tay theo kỳ cho 1 NV (6 cột Kế toán nhập: H/K/AW/O/N/P). */
export interface PayrollPeriodInput {
  period: string; // YYYY-MM
  employee_id: string;
  luong_cb: number;
  ot_extra: number;
  bonus_extra: number;
  ung_luong: number;
  tru_kpi: number;
  dong_phuc: number;
  note?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export const DEFAULT_PAYROLL_FORMULA: Omit<PayrollFormula, 'period'> = {
  rateTV: 21000,
  rateCT: 25500,
  otPerSlot: 0,
  otThreshold1: 10,
  otThreshold2: 15,
};
