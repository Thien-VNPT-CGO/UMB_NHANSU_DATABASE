/**
 * Phân loại "Khối" nhân sự cho các tab kế toán (lương).
 *
 * Quy ước chung (khớp dữ liệu employee.group + branch):
 *  - VAN_PHONG: nhân viên khối Văn Phòng (group === 'VAN_PHONG')
 *  - XUONG:     khối Xưởng Sản Xuất (group === 'XUONG')
 *  - SALE:      khối Sales / MKT (group === 'SALE')
 *  - CUA_HANG:  khối Cửa Hàng — nhóm STORE / chưa phân khối, chi nhánh CN1..CN4
 *
 * Dùng cho: bộ lọc Khối trên mọi tab lương, cột KHỐI trong bảng,
 * tổng hợp theo khối ở Dashboard, và xuất CSV/In theo khối đang lọc.
 */

export type FinanceBlock = 'ALL' | 'VAN_PHONG' | 'XUONG' | 'SALE' | 'CUA_HANG';

export interface FinanceBlockOption {
  id: FinanceBlock;
  label: string;
  short: string;
  icon: string;
}

export const FINANCE_BLOCK_OPTIONS: FinanceBlockOption[] = [
  { id: 'ALL', label: 'Tất cả', short: 'Tất cả', icon: '🗂️' },
  { id: 'VAN_PHONG', label: 'Khối Văn Phòng', short: 'Văn Phòng', icon: '🏢' },
  { id: 'XUONG', label: 'Khối Xưởng SX', short: 'Xưởng', icon: '🏭' },
  { id: 'SALE', label: 'Khối Sales / MKT', short: 'Sales', icon: '📈' },
  { id: 'CUA_HANG', label: 'Khối Cửa Hàng (CN1–CN4)', short: 'Cửa Hàng', icon: '🏪' },
];

export const FINANCE_BLOCK_LABEL: Record<FinanceBlock, string> = {
  ALL: 'Tất cả',
  VAN_PHONG: 'Khối Văn Phòng',
  XUONG: 'Khối Xưởng SX',
  SALE: 'Khối Sales / MKT',
  CUA_HANG: 'Khối Cửa Hàng',
};

export const FINANCE_BLOCK_SHORT: Record<FinanceBlock, string> = {
  ALL: 'Tất cả',
  VAN_PHONG: 'Văn Phòng',
  XUONG: 'Xưởng',
  SALE: 'Sales',
  CUA_HANG: 'Cửa Hàng',
};

/** Màu "chip Khối" trong bảng lương. */
export const FINANCE_BLOCK_STYLE: Record<Exclude<FinanceBlock, 'ALL'>, { c: string; bg: string }> = {
  VAN_PHONG: { c: '#1D4ED8', bg: '#DBEAFE' },
  XUONG: { c: '#92400E', bg: '#FEF3C7' },
  SALE: { c: '#9D174D', bg: '#FCE7F3' },
  CUA_HANG: { c: '#065F46', bg: '#D1FAE5' },
};

/** Trả về Khối của 1 bản ghi NV / dòng lương (chấp nhận nhiều kiểu khoá). */
export function financeBlockOf(row?: any): Exclude<FinanceBlock, 'ALL'> {
  const g = String(row?.group || row?.employment_group || '').toUpperCase();
  if (g === 'VAN_PHONG') return 'VAN_PHONG';
  if (g === 'XUONG') return 'XUONG';
  if (g === 'SALE') return 'SALE';
  const b = String(row?.branchId || row?.default_branch_id || row?.branch_id || '').toUpperCase();
  if (b === 'VAN_PHONG') return 'VAN_PHONG';
  if (b === 'XUONG_SX') return 'XUONG';
  // STORE hoặc chưa rõ khối: phân theo chi nhánh cửa hàng
  return 'CUA_HANG';
}

export function financeBlockLabel(row?: any): string {
  return FINANCE_BLOCK_SHORT[financeBlockOf(row)];
}

/** Lọc danh sách theo khối đang chọn (ALL = giữ nguyên). */
export function filterByFinanceBlock<T extends Record<string, any>>(rows: T[], block: FinanceBlock): T[] {
  if (block === 'ALL') return rows;
  return rows.filter(r => financeBlockOf(r) === block);
}

/** Tổng hợp nhanh theo Khối (dùng cho Dashboard Tài chính). */
export function summarizeFinanceBlocks<T extends Record<string, any>>(rows: T[], valueOf: (r: T) => number = r => Number(r?.netPay ?? r?.total ?? r?.thuc_lanh ?? 0) || 0) {
  const buckets: Record<string, { key: Exclude<FinanceBlock, 'ALL'>; label: string; icon: string; employees: number; value: number; rows: T[] }> = {
    VAN_PHONG: { key: 'VAN_PHONG', label: 'Văn Phòng', icon: '🏢', employees: 0, value: 0, rows: [] },
    XUONG: { key: 'XUONG', label: 'Xưởng SX', icon: '🏭', employees: 0, value: 0, rows: [] },
    SALE: { key: 'SALE', label: 'Sales / MKT', icon: '📈', employees: 0, value: 0, rows: [] },
    CUA_HANG: { key: 'CUA_HANG', label: 'Cửa Hàng', icon: '🏪', employees: 0, value: 0, rows: [] },
  };
  for (const r of rows || []) {
    const key = financeBlockOf(r);
    const b = buckets[key];
    b.employees += 1;
    b.value += valueOf(r) || 0;
    b.rows.push(r);
  }
  return Object.values(buckets);
}
