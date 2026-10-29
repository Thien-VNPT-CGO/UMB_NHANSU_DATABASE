/**
 * Khử ca trùng theo khoá NGHIỆP VỤ (nhân viên + ngày + mã ca), không chỉ theo
 * assignment_id.
 *
 * Vì sao cần: luồng "Cập Nhật Ca" của nhân viên từng ghi thêm 1 dòng
 * PHAN_CONG_CA trong khi full-sync ghi đè cả tab. Khi 2 lần ghi đua nhau, Sheet
 * có thể còn 2 dòng cùng ngày/cùng mã nhưng khác assignment_id. Pull cũ chỉ khử
 * theo assignment_id nên cả 2 lần vào bộ nhớ, hiện 2 thẻ ca giống nhau trên
 * "Dữ Liệu Công Của Tôi" và có thể khiến payroll tính lệch.
 *
 * Quy tắc:
 *  - Ca CANCELLED là dấu vết nghiệp vụ, giữ nguyên (chỉ khử trùng id).
 *  - Ca live (DRAFT/PUBLISHED/...) chỉ giữ 1 bản cho mỗi nhân viên + ngày + mã.
 *  - Bản thắng: PUBLISHED trước, schedule_version cao hơn, rồi updated/created
 *    mới hơn. Sự kiện điểm danh của bản bị bỏ sẽ được logic orphan có sẵn gộp
 *    sang ca giữ lại nên không mất công/lương.
 */

export type ShiftLike = {
  assignment_id?: string | null;
  employee_id?: string | null;
  date?: string | null;
  shift_code?: string | null;
  status?: string | null;
  schedule_version?: number | string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

function dayOf(value: unknown): string {
  return String(value || '').slice(0, 10);
}

function shiftKey(shift: ShiftLike): string {
  return [
    String(shift.employee_id ?? '').trim(),
    dayOf(shift.date),
    String(shift.shift_code || '').trim().toUpperCase(),
  ].join('|');
}

function statusRank(status: unknown): number {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'CANCELLED') return 3;
  if (s === 'PUBLISHED') return 2;
  if (s === 'DRAFT') return 1;
  return 1;
}

/**
 * Chọn bản thắng khi PULL một ca từ Google Sheets về bộ nhớ.
 *
 * Trước đây version bằng nhau thì luôn lấy bản Sheet. Hệ quả: ca vừa được
 * PUBLISHED trong bộ nhớ nhưng dòng Sheet còn DRAFT cùng `schedule_version`
 * (push đang xếp hàng/lỗi mạng) sẽ bị pull hạ ngược về DRAFT -> lịch tuần hiện
 * "ca nháp" vài giây rồi mới xanh lại, cổng NV báo chưa phát hành oan.
 *
 * Quy tắc:
 *  - Version khác nhau: bản version cao thắng (như cũ).
 *  - Version bằng nhau: trạng thái "mạnh" hơn thắng (CANCELLED > PUBLISHED > DRAFT);
 *    cùng trạng thái thì bản Sheet thắng để sửa tay trên Sheet vẫn có hiệu lực.
 */
export function pickPulledShift<T extends ShiftLike>(memory: T | null | undefined, pulled: T): T {
  if (!memory) return pulled;
  const memVersion = Number(memory.schedule_version) || 0;
  const pullVersion = Number(pulled.schedule_version) || 0;
  if (memVersion !== pullVersion) return memVersion > pullVersion ? memory : pulled;
  const memRank = statusRank(memory.status);
  const pullRank = statusRank(pulled.status);
  if (memRank !== pullRank) return memRank > pullRank ? memory : pulled;
  return pulled;
}

function timeOf(value: unknown): number {
  const t = new Date(String(value || '')).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isBetterShift(candidate: ShiftLike, current: ShiftLike): boolean {
  const statusDiff = statusRank(candidate.status) - statusRank(current.status);
  if (statusDiff !== 0) return statusDiff > 0;
  const versionDiff = (Number(candidate.schedule_version) || 0) - (Number(current.schedule_version) || 0);
  if (versionDiff !== 0) return versionDiff > 0;
  const updatedDiff = timeOf(candidate.updated_at) - timeOf(current.updated_at);
  if (updatedDiff !== 0) return updatedDiff > 0;
  return timeOf(candidate.created_at) > timeOf(current.created_at);
}

export function dedupeShiftAssignments<T extends ShiftLike>(shifts: T[]): T[] {
  const out: T[] = [];
  const liveIndexByKey = new Map<string, number>();
  const cancelledIndexById = new Map<string, number>();

  for (const shift of shifts || []) {
    if (!shift) continue;
    const status = String(shift.status || '').trim().toUpperCase();
    if (status === 'CANCELLED') {
      const id = String(shift.assignment_id || '');
      if (!id) {
        out.push(shift);
        continue;
      }
      const existingIndex = cancelledIndexById.get(id);
      if (existingIndex === undefined) {
        cancelledIndexById.set(id, out.length);
        out.push(shift);
      } else if (isBetterShift(shift, out[existingIndex])) {
        out[existingIndex] = shift;
      }
      continue;
    }

    const key = shiftKey(shift);
    const existingIndex = liveIndexByKey.get(key);
    if (existingIndex === undefined) {
      liveIndexByKey.set(key, out.length);
      out.push(shift);
    } else if (isBetterShift(shift, out[existingIndex])) {
      out[existingIndex] = shift;
    }
  }

  return out;
}

/** Có ca live trùng đúng nhân viên + ngày + mã hay chưa (bỏ qua CANCELLED). */
export function findLiveShift<T extends ShiftLike>(
  shifts: T[],
  employeeId: string,
  date: string,
  shiftCode: string,
  excludeAssignmentId?: string,
): T | undefined {
  const wantEmp = String(employeeId ?? '').trim();
  const wantDay = dayOf(date);
  const wantCode = String(shiftCode || '').trim().toUpperCase();
  const exclude = String(excludeAssignmentId || '');
  return (shifts || []).find((s) => {
    if (!s || String(s.status || '').toUpperCase() === 'CANCELLED') return false;
    if (exclude && String(s.assignment_id || '') === exclude) return false;
    return String(s.employee_id ?? '').trim() === wantEmp
      && dayOf(s.date) === wantDay
      && String(s.shift_code || '').trim().toUpperCase() === wantCode;
  });
}
