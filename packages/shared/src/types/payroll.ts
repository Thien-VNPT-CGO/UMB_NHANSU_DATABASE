export type PayrollRunStatus = 'DRAFT' | 'RECONCILED' | 'APPROVED' | 'PUBLISHED' | 'PAID' | 'CONFIRMED' | 'COMPLAINED';

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

export type PayslipSignerRole = 'giamdoc' | 'lap' | 'quanly' | 'nhanvien';

/**
 * Giai đoạn xử lý phiếu lương — DẪN XUẤT từ chữ ký + trạng thái (không lưu riêng,
 * tránh lệch dữ liệu). Dùng chung FE/BE/PDF để hiển thị timeline & khóa nút.
 *
 * Thứ tự: Kế toán lập & ký (DRAFT→) → Giám đốc ký duyệt → Kế toán gửi NV
 * → Nhân viên ký → phiếu về Kế toán (KHÓA, hiện QR chuyển khoản)
 * → Kế toán bấm "Đã Chuyển Khoản" → PAID (khóa hoàn toàn, đồng bộ Drive).
 */
export type PayslipStage =
  | 'DRAFT'            // chưa ký gì
  | 'CHO_GD_DUYET'     // KT đã ký, chờ Giám đốc duyệt
  | 'CHO_GUI_NV'       // GĐ đã duyệt, chờ KT gửi NV
  | 'CHO_NV_KY'        // đã gửi, chờ NV ký
  | 'BI_KHIEU_NAI'     // NV khiếu nại (phiếu trả về KT kiểm tra lại)
  | 'CHO_CHUYEN_KHOAN' // NV đã ký — phiếu KHÓA, chờ KT chuyển khoản (hiện QR)
  | 'PAID';            // KT đã chuyển khoản — khóa hoàn toàn

export function payslipStage(
  slip: Pick<PayslipItem, 'status' | 'sign_lap' | 'sign_giamdoc' | 'sign_nhanvien'> & { complaint_status?: string } | null | undefined,
): PayslipStage {
  if (!slip) return 'DRAFT';
  const st = String(slip.status || '').toUpperCase();
  if (st === 'PAID') return 'PAID';
  if (st === 'COMPLAINED' || String((slip as any).complaint_status || '').toUpperCase() === 'PENDING') return 'BI_KHIEU_NAI';
  if (st === 'CONFIRMED' || slip.sign_nhanvien) return 'CHO_CHUYEN_KHOAN';
  if (st === 'PUBLISHED') return 'CHO_NV_KY';
  if (slip.sign_lap && slip.sign_giamdoc) return 'CHO_GUI_NV';
  if (slip.sign_lap) return 'CHO_GD_DUYET';
  return 'DRAFT';
}

export const PAYSLIP_STAGE_LABEL: Record<PayslipStage, string> = {
  DRAFT: 'Nháp — Kế toán chưa ký',
  CHO_GD_DUYET: 'Chờ Giám đốc ký duyệt',
  CHO_GUI_NV: 'Chờ Kế toán gửi nhân viên',
  CHO_NV_KY: 'Chờ nhân viên ký nhận',
  BI_KHIEU_NAI: 'NV khiếu nại — chờ Kế toán kiểm tra lại',
  CHO_CHUYEN_KHOAN: 'Chờ chuyển khoản (đã khóa phiếu)',
  PAID: 'Đã chuyển khoản',
};

/** Thứ tự bước trong timeline 6 nấc — dùng cho stepper UI/PDF. */
export const PAYSLIP_STAGE_STEPS: Array<{ key: PayslipStage; label: string }> = [
  { key: 'DRAFT', label: 'KT tạo & ký' },
  { key: 'CHO_GD_DUYET', label: 'Giám đốc ký' },
  { key: 'CHO_GUI_NV', label: 'KT gửi NV' },
  { key: 'CHO_NV_KY', label: 'NV ký nhận' },
  { key: 'BI_KHIEU_NAI', label: 'NV khiếu nại' },
  { key: 'CHO_CHUYEN_KHOAN', label: 'Chờ chuyển khoản' },
  { key: 'PAID', label: 'Đã chuyển khoản' },
];

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
  /** Chữ ký Giám đốc — bắt buộc trước chữ ký quản lý chi nhánh với phiếu mới. */
  sign_giamdoc?: PayslipSignature;
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
  // --- Khiếu nại phiếu lương (NV gửi khi phiếu PUBLISHED có sai) ---
  /** Lý do khiếu nại (VD: THIẾU CÔNG, SAI ĐƠN GIÁ, SAI KHẤU TRỪ...). */
  complaint_reason?: string;
  /** Nội dung khiếu nại chi tiết. */
  complaint_detail?: string;
  /** Thời điểm NV gửi khiếu nại. */
  complaint_at?: string;
  /** ID NV khiếu nại. */
  complaint_by?: string;
  /** NONE | PENDING | RESOLVED — PENDING = phiếu đã trả về KT kiểm tra lại. */
  complaint_status?: 'NONE' | 'PENDING' | 'RESOLVED';
  /** Thời điểm KT xử lý xong khiếu nại (hoàn phiếu về DRAFT). */
  complaint_resolved_at?: string;
  complaint_resolved_by?: string;
  // --- Đồng bộ Google Drive (PDF phiếu lương sau khi Đã Chuyển Khoản) ---
  /** ID file PDF trên Drive. */
  drive_pdf_id?: string;
  /** Link xem file trên Drive. */
  drive_pdf_link?: string;
  /** Thời điểm đồng bộ Drive thành công gần nhất. */
  drive_synced_at?: string;
  /** Lỗi đồng bộ Drive lần gần nhất (rỗng nếu OK). */
  drive_sync_error?: string;
  /** Giai đoạn xử lý (dẫn xuất — BE gắn vào payload để FE không phải tự đoán). */
  stage?: PayslipStage;
  /** Ghi chú của kế toán nhập ở tab Tính lương (join từ DULIEU_LUONG_KY) — hiển thị trên phiếu khi in/phát hành. */
  input_note?: string;
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
