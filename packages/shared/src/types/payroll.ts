export type PayrollRunStatus = 'DRAFT' | 'RECONCILED' | 'APPROVED' | 'PUBLISHED' | 'PAID';

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
  allowance: number;
  bonus: number;
  deduction: number;
  net_pay: number;
  // --- Mở rộng theo file Excel lương (Payment/BCC): các trường optional để
  // phiếu cũ vẫn đọc được, phiếu mới tính theo công thức có đủ breakdown.
  /** Số suất tăng ca (ngày >=10h: 1 suất, >=15h: 2 suất). */
  ot_slots?: number;
  /** Phụ cấp tăng ca = ot_slots × đơn giá suất (Excel: AQ*30000). */
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
  /** TỔNG CỘNG = luong_cb + allowance + standard_pay + ot_extra + bonus (Excel M). */
  tong_cong?: number;
  /** TỔNG LƯƠNG = tong_cong - tru_kpi - deduction (Excel Q). */
  tong_luong?: number;
  /** THỰC LÃNH = tong_luong - ung_luong - dong_phuc (Excel R). */
  thuc_lanh?: number;
  status: PayrollRunStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Công thức tính lương 1 kỳ (lưu từ file Excel lương của Kế toán):
 * TỔNG CỘNG = luong_cb + phu_cap_ot + luong_gio + ot_extra + bonus
 * TỔNG LƯƠNG = TỔNG CỘNG − tru_kpi − phạt trễ/vắng
 * THỰC LÃNH = TỔNG LƯƠNG − ung_luong − dong_phuc
 */
export interface PayrollFormula {
  period: string; // YYYY-MM
  /** Đơn giá giờ thử việc (Excel TV 21K, mặc định 21000). */
  rateTV: number;
  /** Đơn giá giờ chính thức (Excel CT 25.5K/30K, mặc định 25500). */
  rateCT: number;
  /** Tiền 1 suất tăng ca (Excel 30000). */
  otPerSlot: number;
  /** Ngưỡng giờ/ngày tính 1 suất OT (Excel 10). */
  otThreshold1: number;
  /** Ngưỡng giờ/ngày tính 2 suất OT (Excel 15). */
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
  otPerSlot: 30000,
  otThreshold1: 10,
  otThreshold2: 15,
};
