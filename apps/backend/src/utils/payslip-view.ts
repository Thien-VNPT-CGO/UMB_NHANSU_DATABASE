import { payslipStage } from '@ubm/shared';

/** Gắn `stage` (giai đoạn xử lý phiếu) vào 1 phiếu — dùng cho mọi response API trả phiếu lương. */
export const withStage = <T extends Record<string, any> | null | undefined>(s: T): T & { stage?: string } => {
  if (!s) return s as any;
  return { ...(s as any), stage: payslipStage(s as any) };
};

export const withStageAll = <T extends Record<string, any>>(arr: T[] | null | undefined): Array<T & { stage?: string }> =>
  (arr || []).map((s) => withStage(s) as any);
