import { useState } from 'react';
import { List } from 'lucide-react';

/**
 * Ẩn/hiện cột dùng chung cho MỌI bảng của Cổng Kế toán.
 *
 * - `FINANCE_COLUMN_DEFS`: danh sách cột có thể ẩn/hiện theo từng bảng. Khóa
 *   ngoài cùng là "bảng" (tabKey) — một tab có thể có nhiều bảng nên dùng key
 *   riêng (VD `fin-dashboard-block` và `fin-dashboard-branch`).
 * - `ColumnSettings`: nút + panel tick chọn.
 * - `financeColHeaderCount`: số cột đang hiện để tính `colSpan` dòng tổng.
 *
 * Trạng thái được FinanceModule lưu theo TÀI KHOẢN kế toán qua
 * `GET/PUT /payroll/table-columns` (khóa `financeColumnVis:<id>` trong
 * CAU_HINH_HE_THONG) nên máy khác cùng tài khoản thấy ngay (realtime).
 */
export const FINANCE_COLUMN_DEFS: Record<string, Array<{ key: string; label: string }>> = {
  'fin-timesheet': [
    { key: 'stt', label: 'STT' }, { key: 'fullName', label: 'Họ tên' }, { key: 'code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
    { key: 'full', label: 'Ca đủ' }, { key: 'partial', label: 'Thiếu' }, { key: 'absent', label: 'Vắng' }, { key: 'hours', label: 'Giờ công' },
    { key: 'standardPay', label: 'Lương ca' }, { key: 'deduction', label: 'Trừ' }, { key: 'netPay', label: 'THỰC NHẬN' },
  ],
  'fin-bcc': [
    { key: 'summary', label: 'Tóm tắt NV (giờ/đủ/thiếu/vắng/tiền)' }, { key: 'date', label: 'Ngày' }, { key: 'shift', label: 'Ca' }, { key: 'hours', label: 'Giờ' },
    { key: 'status', label: 'Trạng thái' }, { key: 'checkIn', label: 'Check-in' }, { key: 'lateMin', label: 'Trễ (phút)' }, { key: 'shiftPay', label: 'Lương ca' }, { key: 'fineAmount', label: 'Phạt/Trừ' },
  ],
  'fin-calculate': [
    { key: 'stt', label: 'STT' }, { key: 'code', label: 'Mã NV' }, { key: 'name', label: 'Họ tên' }, { key: 'branch', label: 'Chi nhánh' },
    { key: 'luong_cb', label: 'LCB' }, { key: 'ot_extra', label: 'OT thêm' }, { key: 'bonus_extra', label: 'Bonus' }, { key: 'ung_luong', label: 'Ứng lương' },
    { key: 'tru_kpi', label: 'Trừ KPI' }, { key: 'dong_phuc', label: 'Trừ ĐP' }, { key: 'note', label: 'Ghi chú' },
    { key: 'b1', label: 'B1 Giờ/LCB' }, { key: 'b2', label: 'B2 Tổng cộng' }, { key: 'b3', label: 'B3 Tổng lương' }, { key: 'b4', label: 'B4 Thực lãnh' },
  ],
  'fin-payroll-sheet': [
    { key: 'stt', label: 'STT' }, { key: 'full_name', label: 'Họ tên' }, { key: 'employee_code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
    { key: 'gio', label: 'Giờ công' }, { key: 'banCa', label: 'Lương ca' }, { key: 'phuCap', label: 'Phụ cấp' }, { key: 'lcb', label: 'LCB' },
    { key: 'ot', label: 'OT thêm' }, { key: 'bonus', label: 'Bonus' }, { key: 'tongCong', label: 'TỔNG CỘNG' }, { key: 'truKpiPhat', label: 'Trừ KPI/phạt' },
    { key: 'ung', label: 'Ứng lương' }, { key: 'dongPhuc', label: 'Trừ ĐP' }, { key: 'tongLuong', label: 'TỔNG LƯƠNG' }, { key: 'thuc', label: 'THỰC LÃNH' }, { key: 'status', label: 'Trạng thái' },
  ],
  'fin-payroll-periods': [
    { key: 'stt', label: 'STT' }, { key: 'full_name', label: 'Họ tên' }, { key: 'employee_code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
    { key: 'gio', label: 'Giờ công' }, { key: 'banCa', label: 'Lương ca' }, { key: 'phuCap', label: 'Phụ cấp' }, { key: 'lcb', label: 'LCB' },
    { key: 'ot', label: 'OT thêm' }, { key: 'bonus', label: 'Bonus' }, { key: 'tongCong', label: 'TỔNG CỘNG' }, { key: 'truKpiPhat', label: 'Trừ KPI/phạt' },
    { key: 'ung', label: 'Ứng lương' }, { key: 'dongPhuc', label: 'Trừ ĐP' }, { key: 'tongLuong', label: 'TỔNG LƯƠNG' }, { key: 'thuc', label: 'THỰC LÃNH' },
    { key: 'status', label: 'Trạng thái phiếu' }, { key: 'edit', label: 'Sửa trực tiếp' },
  ],
  'fin-payslips': [
    { key: 'stt', label: 'STT' }, { key: 'full_name', label: 'Họ tên' }, { key: 'employee_code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
    { key: 'gio', label: 'Giờ công' }, { key: 'banCa', label: 'Lương ca' }, { key: 'phuCap', label: 'Phụ cấp' }, { key: 'lcb', label: 'LCB' },
    { key: 'ot', label: 'OT thêm' }, { key: 'bonus', label: 'Bonus' }, { key: 'tongCong', label: 'TỔNG CỘNG' }, { key: 'truKpiPhat', label: 'Trừ KPI/phạt' },
    { key: 'ung', label: 'Ứng lương' }, { key: 'dongPhuc', label: 'Trừ ĐP' }, { key: 'tongLuong', label: 'TỔNG LƯƠNG' }, { key: 'thuc', label: 'THỰC LÃNH' },
    { key: 'sign', label: 'Trạng thái / Chữ ký' }, { key: 'action', label: 'Thao tác' },
  ],
  'fin-payment': [
    { key: 'stt', label: 'STT' }, { key: 'full_name', label: 'Họ tên' }, { key: 'employee_code', label: 'Mã NV' }, { key: 'branch', label: 'Chi nhánh' },
    { key: 'gio', label: 'Giờ công' }, { key: 'banCa', label: 'Lương ca' }, { key: 'phuCap', label: 'Phụ cấp' }, { key: 'lcb', label: 'LCB' },
    { key: 'ot', label: 'OT thêm' }, { key: 'bonus', label: 'Bonus' }, { key: 'tongCong', label: 'TỔNG CỘNG' }, { key: 'truKpiPhat', label: 'Trừ KPI/phạt' },
    { key: 'ung', label: 'Ứng lương' }, { key: 'dongPhuc', label: 'Trừ ĐP' }, { key: 'tongLuong', label: 'TỔNG LƯƠNG' }, { key: 'thuc', label: 'THỰC LÃNH' },
    { key: 'bank', label: 'Ngân hàng / STK' }, { key: 'qr', label: 'VietQR' }, { key: 'action', label: 'Thao tác' },
  ],
  /** Tab 1 — bảng "Lương theo Khối". */
  'fin-dashboard-block': [
    { key: 'block', label: 'Khối' }, { key: 'nv', label: 'NV' }, { key: 'hours', label: 'Giờ' },
    { key: 'total', label: 'T.Cộng' }, { key: 'net', label: 'Thực lĩnh' },
  ],
  /** Tab 1 — bảng "Lương theo Chi nhánh". */
  'fin-dashboard-branch': [
    { key: 'branch', label: 'Chi nhánh' }, { key: 'nv', label: 'NV' }, { key: 'hours', label: 'Giờ' },
    { key: 'shiftPay', label: 'Lương ca' }, { key: 'deduction', label: 'Trừ' }, { key: 'net', label: 'Thực nhận' },
  ],
  /** Tab 12 — danh sách NV điều chỉnh đơn giá ca. Cột "Đơn giá MỚI" luôn hiện. */
  'fin-rate-adjust': [
    { key: 'select', label: 'Chọn' }, { key: 'code', label: 'Mã NV' }, { key: 'name', label: 'Họ tên' },
    { key: 'stage', label: 'Giai đoạn' }, { key: 'currentRate', label: 'Đơn giá hiện tại' },
    { key: 'delta', label: 'Chênh lệch' }, { key: 'history', label: 'Lịch sử' },
  ],
  /** Tab "Cấu hình lương CB". Cột "Lưu" luôn hiện. */
  'fin-salary-config': [
    { key: 'code', label: 'Mã NV' }, { key: 'name', label: 'Họ và tên' }, { key: 'block', label: 'Khối' }, { key: 'branch', label: 'Chi nhánh' },
    { key: 'stage', label: 'Giai đoạn' }, { key: 'mode', label: 'Hình thức lương' }, { key: 'base', label: 'Lương cơ bản' },
    { key: 'allowance', label: 'Phụ cấp' }, { key: 'total', label: 'Tổng lương' }, { key: 'updated', label: 'Cập nhật' },
  ],
  /** Tab "Duyệt văn phòng" — 2 bảng nghỉ phép & bổ sung công. Cột "Duyệt" luôn hiện. */
  'office-approvals': [
    { key: 'employee', label: 'Nhân viên' }, { key: 'date', label: 'Ngày' }, { key: 'reason', label: 'Lý do' }, { key: 'status', label: 'Trạng thái' },
  ],
  /** Tab "QR ngân hàng NV" — dạng thẻ, ẩn/hiện từng dòng thông tin. */
  'fin-bank-qr': [
    { key: 'qr', label: 'Mã QR' }, { key: 'name', label: 'Họ tên / Mã NV' }, { key: 'bank', label: 'Ngân hàng' },
    { key: 'account', label: 'Số tài khoản' }, { key: 'holder', label: 'Chủ tài khoản' },
  ],
};

/** Số cột đang hiển thị của 1 bảng (để tính colSpan dòng tổng). */
export const financeColHeaderCount = (tabKey: string, defs: any, cols: any) => {
  const show = cols?.show;
  if (!show || !defs) return 1;
  return (defs as any[]).filter((d: any) => show(d.key)).length || 1;
};

/** Nút + panel ẩn/hiện cột cho 1 bảng (dùng chung cho mọi tab Finance). */
export function ColumnSettings({ tabKey, defs, value, onToggle, onShowAll, saving }: any) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fin-colsettings" style={{ position: 'relative' }}>
      <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => setOpen(v => !v)} title="Ẩn/hiện các cột bảng (lưu theo tài khoản, đồng bộ realtime mọi máy)">
        <List size={13} /> {saving ? 'Đang lưu…' : 'Cột hiển thị'}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, width: 280, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 12px 32px rgba(15,23,42,.18)', padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6 }}>Cột hiển thị — bảng này (lưu theo tài khoản)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
            {(defs || []).map((d: any) => (
              <label key={d.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={value?.[tabKey]?.[d.key] !== false} onChange={() => onToggle(tabKey, d.key)} /> {d.label}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="fin-btn fin-btn-primary fin-btn-sm" onClick={onShowAll}>Hiện tất cả</button>
            <button type="button" className="fin-btn fin-btn-ghost fin-btn-sm" onClick={() => setOpen(false)}>Đóng</button>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--fin-muted)', marginTop: 6 }}>Sẽ đồng bộ realtime cho máy khác cùng tài khoản.</div>
        </div>
      )}
    </div>
  );
}
