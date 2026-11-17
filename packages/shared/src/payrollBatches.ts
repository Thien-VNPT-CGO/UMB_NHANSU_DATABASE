/**
 * ĐỢT TÍNH LƯƠNG — chia 1 kỳ lương thành 2 đợt độc lập:
 *
 *  - Đợt 1 · Khối Cửa hàng (STORE): chỉ tính nhân viên khối Cửa hàng.
 *  - Đợt 2 · Khối Tổng hợp (TONG_HOP): Văn phòng + Xưởng + Sales.
 *
 * Kế toán được chọn tính đợt nào trước cũng được (1 → 2 hoặc 2 → 1), thậm chí
 * tính lại riêng 1 đợt mà không đụng số liệu đợt còn lại. Mỗi đợt sinh 1 kỳ
 * lương (run) riêng, phiếu lương của 2 đợt được gộp lại khi xem kỳ/tháng.
 */
import { payGroupKey } from './payMode.js';

export type PayrollBatchId = 'STORE' | 'TONG_HOP';

/** 'ALL' = tính toàn bộ công ty (tương thích dữ liệu/quy trình cũ). */
export type PayrollBatchScope = PayrollBatchId | 'ALL';

export interface PayrollBatchDef {
  id: PayrollBatchId;
  /** Thứ tự hiển thị mặc định (kế toán vẫn được chọn tính đợt 2 trước). */
  order: number;
  label: string;
  shortLabel: string;
  /** Khối nhân sự thuộc đợt này (giá trị cột `group` của NHAN_VIEN_MASTER). */
  groups: string[];
  desc: string;
  /** Màu nhận diện (dùng cho badge/tile ở cổng Kế toán). */
  color: string;
  bg: string;
}

export const PAYROLL_BATCHES: PayrollBatchDef[] = [
  {
    id: 'STORE',
    order: 1,
    label: 'Khối Cửa hàng',
    shortLabel: 'Cửa hàng',
    groups: ['STORE'],
    desc: 'Toàn bộ nhân viên khối Cửa hàng (STORE) — lương theo ca.',
    color: '#E85D92',
    bg: '#FDF2F7',
  },
  {
    id: 'TONG_HOP',
    order: 2,
    label: 'Khối Tổng hợp',
    shortLabel: 'Tổng hợp',
    groups: ['VAN_PHONG', 'XUONG', 'SALE'],
    desc: 'Khối Văn phòng + Xưởng + Sales — lương tháng/theo ca theo cấu hình từng NV.',
    color: '#0F766E',
    bg: '#ECFDF5',
  },
];

export const PAYROLL_BATCH_ALL_LABEL = 'Toàn công ty';

export function isPayrollBatchId(value: unknown): value is PayrollBatchId {
  const v = String(value ?? '').trim().toUpperCase();
  return v === 'STORE' || v === 'TONG_HOP';
}

/** Chuẩn hóa 1 giá trị đợt từ input thô. Không hợp lệ -> null. */
export function normalizePayrollBatch(value: unknown): PayrollBatchId | null {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'STORE' || v === 'CUA_HANG' || v === 'CUAHANG') return 'STORE';
  if (v === 'TONG_HOP' || v === 'TONGHOP') return 'TONG_HOP';
  return null;
}

/** Đợt của 1 nhân viên theo khối (STORE -> đợt 1, còn lại -> đợt 2). */
export function batchOfGroup(group: unknown): PayrollBatchId {
  const g = payGroupKey(group);
  if (g === 'STORE' || g === 'CUA_HANG' || g === 'CUAHANG' || g.startsWith('CUA_HANG')) return 'STORE';
  return 'TONG_HOP';
}

/** Nhân viên thuộc đợt đang chọn? (batch 'ALL' luôn đúng). */
export function employeeInBatch(group: unknown, batch?: PayrollBatchScope | null): boolean {
  if (!batch || batch === 'ALL') return true;
  return batchOfGroup(group) === batch;
}

/** Nhãn tiếng Việt đầy đủ của đợt. */
export function payrollBatchLabel(batch?: PayrollBatchScope | string | null): string {
  const id = String(batch || '').trim().toUpperCase();
  if (!id || id === 'ALL') return PAYROLL_BATCH_ALL_LABEL;
  return PAYROLL_BATCHES.find(b => b.id === id)?.label || id;
}

/** Nhãn ngắn gọn (dùng cho cột bảng). */
export function payrollBatchShortLabel(batch?: PayrollBatchScope | string | null): string {
  const id = String(batch || '').trim().toUpperCase();
  if (!id || id === 'ALL') return 'Tất cả';
  return PAYROLL_BATCHES.find(b => b.id === id)?.shortLabel || id;
}

/**
 * Đợt được MÃ HÓA trong run_id (`PAY_2026_11_STORE_...`) — dùng để khôi phục
 * đợt sau khi đọc lại từ Google Sheets / DB cũ chưa có cột batch_scope.
 * Trả null nếu run cũ (tính gộp toàn công ty).
 */
export function payrollBatchOfRunId(runId?: string | null): PayrollBatchId | null {
  const s = String(runId || '').toUpperCase();
  if (!s) return null;
  if (s.includes('_TONG_HOP_') || s.includes('_TONGHOP_')) return 'TONG_HOP';
  if (s.includes('_STORE_') || s.includes('_CUAHANG_') || s.includes('_CUA_HANG_')) return 'STORE';
  return null;
}

/** Đợt hiệu lực của 1 kỳ lương: ưu tiên batch_scope, sau đó suy ra từ run_id. */
export function batchOfRun(run: any): PayrollBatchScope | null {
  const raw = String(run?.batch_scope ?? '').trim().toUpperCase();
  if (raw === 'STORE' || raw === 'TONG_HOP' || raw === 'ALL') return raw as PayrollBatchScope;
  return payrollBatchOfRunId(run?.run_id);
}
