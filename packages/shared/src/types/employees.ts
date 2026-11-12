export type EmploymentStatus = 'PRE_ONBOARDING' | 'PROBATION' | 'OFFICIAL' | 'TERMINATED';
export type EmployeeGroup = 'STORE' | 'XUONG' | 'VAN_PHONG' | 'SALE';

export interface EmployeeMaster {
  employee_id: string;
  employee_code: string; // e.g. UBM_NV000001
  full_name: string;
  phone_normalized: string;
  id_card_number?: string;
  email?: string;
  gender?: 'NAM' | 'NU' | 'KHAC';
  birth_date?: string;
  employment_status: EmploymentStatus;
  group: EmployeeGroup;
  default_branch_id: string; // e.g. CN130
  /** Ca làm cố định (CA_1/CA_2/CA_3) — BOT dựa vào đây để tự xếp lịch khi PUBLISH. */
  default_shift_code?: 'CA_1' | 'CA_2' | 'CA_3';
  current_rate_per_hour: number; // e.g. 21000 for probation, 25500 for official
  start_date: string;
  official_date?: string;
  bank_name?: string;
  bank_account?: string;
  bank_holder?: string;
  /** Ảnh mã QR ngân hàng do NV tự tải lên ở Hồ sơ (dataURL, ≤45KB) — Finance xem ở tab QR ngân hàng NV. */
  bank_qr_img?: string;
  /**
   * File Hợp đồng lao động (Thử việc / Chính thức) do HR upload ở tab Hồ Sơ.
   * Metadata lưu 1 ô JSON trên NHAN_VIEN_MASTER; file thật nằm trên Google Drive
   * (chính) + đĩa VPS (dự phòng) — KHÔNG nhét base64 vào Sheet.
   */
  contract_docs?: EmployeeContractDocs;
  /**
   * Thông tin nhận ĐỒNG PHỤC do HR nhập ở tab Hồ Sơ Nhân Viên.
   * 1 áo = 150.000đ; số tiền = số lượng × đơn giá, tự trừ vào lương
   * của tháng chứa `received_date` (Finance thấy realtime).
   */
  uniform?: EmployeeUniformInfo;
  /**
   * Cờ DANH SÁCH ĐEN: NV thử việc nghỉ giữa kỳ (chưa/đã đủ 7 ngày thử việc) bị
   * đưa vào danh sách đen -> khóa đăng nhập web app, ẩn khỏi Lịch làm việc,
   * NHƯNG giữ nguyên hồ sơ + điểm danh + công + phiếu lương để tính lương.
   */
  blacklisted?: boolean;
  /** Chi tiết danh sách đen (lý do, ghi chú, người đưa vào, thời điểm). */
  blacklist?: EmployeeBlacklist;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface EmployeeBlacklist {
  /** Lý do đưa vào danh sách đen (HR chọn/nhập). */
  reason: string;
  /** Ghi chú chi tiết thêm (không bắt buộc). */
  note?: string;
  /** ISO timestamp (giờ máy chủ) lúc đưa vào danh sách đen. */
  blacklisted_at: string;
  /** ID admin/HR thực hiện. */
  blacklisted_by: string;
  /** Giai đoạn khi đưa vào danh sách đen (thực tế luôn là PROBATION). */
  stage?: EmploymentStatus;
  /** Số ngày thử việc đã trải qua (0..12) — để HR đối soát 7 ngày. */
  probation_days?: number;
}

export interface EmployeeContractDocMeta {
  /** Drive file ID (rỗng nếu chỉ lưu được trên đĩa VPS). */
  drive_id: string;
  file_name: string;
  mime_type: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string;
  /** DRIVE = đã lên Drive, DISK = chỉ có bản trên VPS (chờ retry). */
  storage?: 'DRIVE' | 'DISK';
}

export interface EmployeeContractDocs {
  probation?: EmployeeContractDocMeta;
  official?: EmployeeContractDocMeta;
  id_card_front?: EmployeeContractDocMeta;
  id_card_back?: EmployeeContractDocMeta;
  /** Giấy khám sức khỏe (HR upload — đồng bộ Google Drive cùng hồ sơ NV). */
  health_cert?: EmployeeContractDocMeta;
}

/**
 * Thông tin nhận đồng phục của nhân viên.
 *
 * Quy định: 1 áo đồng phục = 150.000đ. HR nhập ngày nhận + số lượng; số tiền
 * (`amount`) tự tính = quantity × unit_price và được trừ vào lương đúng tháng
 * của `received_date` trên cổng Kế Toán.
 */
export interface EmployeeUniformInfo {
  /** Ngày nhận đồng phục (YYYY-MM-DD) — quyết định tháng trừ tiền lương. */
  received_date: string;
  /** Số lượng áo đồng phục đã nhận. */
  quantity: number;
  /** Đơn giá mỗi áo (mặc định 150.000đ). */
  unit_price: number;
  /** Tổng tiền = quantity × unit_price. */
  amount: number;
  /** ISO timestamp lần cập nhật gần nhất. */
  updated_at?: string;
  /** ID admin/HR cập nhật gần nhất. */
  updated_by?: string;
}

export interface EmployeeStageHistory {
  period_id: string;
  employee_id: string;
  stage: EmploymentStatus;
  effective_from: string;
  effective_to?: string;
  rate_per_hour: number;
  rate_policy_id?: string;
  note?: string;
  approved_by: string;
  version: number;
  created_at: string;
}

export interface CandidateApplication {
  submission_id: string;
  full_name: string;
  phone_normalized: string;
  birth_year: number;
  /** Chuỗi "Năm Sinh" NGUYÊN BẢN từ Google Form (VD "2004 - 2008", "2008 trở lên").
   *  Form hỏi theo khoảng tuổi nên không được ép về 1 năm — Sheet đích phải giữ đúng
   *  giá trị thật; `birth_year` chỉ là số suy ra để tính điểm AI/xếp hạng. */
  birth_year_raw?: string;
  apply_position: string;
  preferred_branch_id: string;
  status: 'NEW' | 'NEED_INFO' | 'INVITED_INTERVIEW' | 'CONFIRMED' | 'DECLINED' | 'RESCHEDULE_REQUESTED' | 'RESCHEDULE_PROPOSED' | 'INTERVIEWED' | 'ACCEPTED' | 'REJECTED' | 'NO_SHOW' | 'BLACKLIST' | string;
  interview_date?: string;
  interview_time_slot?: string;
  interviewer_id?: string;
  /** Lý do ứng viên từ chối tham gia PV qua link xác nhận (bắt buộc nhập, tối đa 500 ký tự). */
  interview_decline_reason?: string;
  interview_score?: number;
  /** Bộ rubric đã chấm: 'store' (9 câu) | 'office' (7 câu). */
  interview_rubric?: string;
  /** Chi tiết chấm rubric (JSON: {rubric, total, hasLoai, answers}). */
  interview_score_detail?: string;
  interview_notes?: string;
  /** Trạng thái gửi thư mời Zalo: SENT | NOT_FRIEND | FAILED */
  zalo_invite_status?: string;
  /** Ghi chú Zalo/SĐT phụ HR nhập tay vào cột "Zalo Thư Mời" trên Sheet (dữ liệu cũ).
   *  Không phải trạng thái gửi — tách riêng để không bị ghi đè thành mã trạng thái. */
  zalo_invite_note?: string;
  zalo_uid?: string;
  zalo_invite_at?: string;
  zalo_invite_error?: string;
  created_at: string;

  // 17 Cột Biểu Mẫu Tuyển Dụng Google Forms theo yêu cầu HR
  gender?: string; // Giới tính (Nam / Nữ / Khác)
  education_level?: string; // Trình độ (Đại học, Cao đẳng, THPT...)
  hometown?: string; // Quê quán
  phone?: string; // SĐT hiển thị gốc
  registered_shift?: string; // Ca đăng ký
  branch_name?: string; // Chi nhánh đăng ký
  experience?: string; // Kinh nghiệm
  emergency_handling?: string; // Xử lý đột xuất
  facebook_url?: string; // Link Facebook (click xem trực tiếp)
  referral_source?: string; // Nguồn biết tin
  ai_score?: number; // Điểm AI tự động chấm
  screening_result?: string; // Kết quả sàng lọc
  source_code?: string; // Mã nguồn
  /** Ưu tiên vào việc: HR đánh dấu sau khi phỏng vấn xong. */
  vip?: boolean;
  vip_at?: string;
  vip_by?: string;
  /** Cấp bậc VIP trong cùng chi nhánh (1 = ưu tiên nhất). Khác chi nhánh thì độc lập. */
  vip_rank?: number;
}
