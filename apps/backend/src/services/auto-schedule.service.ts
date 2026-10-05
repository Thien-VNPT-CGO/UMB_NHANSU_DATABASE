import { ShiftCode, SHIFT_TEMPLATES } from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { weekRangeOf } from './weekly-off.service.js';
import { Server } from 'socket.io';

/**
 * BOT tự xếp lịch khi PUBLISH (sau khi hết hạn đăng ký OFF 2 ngày/tuần).
 *
 * Quy tắc:
 * 1. Cùng chi nhánh + cùng ca cố định: trừ 2 ngày OFF đã đăng ký của mỗi người,
 *    các ngày còn lại 2 người KHÔNG trực cùng ngày (mỗi ngày/ca chỉ 1 người).
 * 2. Cùng chi nhánh + khác ca: độc lập từng ca nên được trùng ngày.
 * 3. Khác chi nhánh: chạy độc lập từng chi nhánh nên được trùng ngày.
 * 4. Chỉ lấp chỗ trống: ngày/ca đã có ca xếp tay (DRAFT/PUBLISHED) thì giữ nguyên.
 * 5. Ưu tiên người ít ngày công tháng (tháng dương lịch chứa ngày xếp) để đảm bảo
 *    tối thiểu 12 ngày làm việc/tháng, rồi đến người ít ca trong tuần (chia 3/4).
 * 6. NV THỬ VIỆC độc lập hoàn toàn: ca thử việc (tự đăng ký 5 OFF / tự thêm ca)
 *    KHÔNG chiếm slot của NV chính thức — BOT xếp lịch chính thức như thể các
 *    ca thử việc không tồn tại (không ảnh hưởng lẫn nhau).
 */
export interface AutoPlanItem {
  employee_id: string;
  employee_name: string;
  branch_id: string;
  shift_code: ShiftCode;
  date: string;
}

export interface AutoPlanWarning {
  date?: string;
  shift_code?: string;
  employee_id?: string;
  message: string;
}

export interface AutoPlanEmpStat {
  employee_id: string;
  employee_name: string;
  shift_code: ShiftCode;
  weekly_days: number;
  monthly_days: number;
  monthly_key: string;
  monthly_days_2?: number;
  monthly_key_2?: string;
}

export interface AutoPlanResult {
  weekMon: string;
  weekSun: string;
  branchId: string;
  items: AutoPlanItem[];
  warnings: AutoPlanWarning[];
  stats: AutoPlanEmpStat[];
}

const ACTIVE_SHIFTS: ShiftCode[] = ['CA_1', 'CA_2', 'CA_3'];

/**
 * Chuẩn hóa mã chi nhánh (Sheets có thể ghi CN1/CN2/CN3/CN4 trong khi
 * hệ thống dùng CN130/CN261/CN120/CN111) để BOT không bỏ sót nhân viên.
 */
export function canonicalBranch(branchId?: string): string {
  const b = String(branchId || '').trim().toUpperCase();
  if (b === 'CN1' || b === 'CN130') return 'CN130';
  if (b === 'CN2' || b === 'CN261') return 'CN261';
  if (b === 'CN3' || b === 'CN120') return 'CN120';
  if (b === 'CN4' || b === 'CN111') return 'CN111';
  return b;
}

const sameBranch = (a?: string, b?: string): boolean => {
  if (!a || !b) return false;
  if (a === '*' || b === '*') return true;
  return canonicalBranch(a) === canonicalBranch(b);
};

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthRangeOf(dateStr: string): { first: string; last: string; key: string } {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { first: `${y}-${mm}-01`, last: `${y}-${mm}-${lastDay}`, key: `${y}-${mm}` };
}

function isValidOff(status: string): boolean {
  return status === 'PENDING' || status === 'APPROVED';
}

export async function buildAutoPlan(
  repo: ISheetsRepository,
  branchId: string,
  weekMonInput: string
): Promise<AutoPlanResult> {
  const wk = weekRangeOf(weekMonInput);
  const weekMon = wk.mon;
  const weekSun = wk.sun;
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) dates.push(addDays(weekMon, i));

  const employees = (await repo.listEmployees(branchId === '*' ? undefined : { branch: branchId }).catch(() => [])) as any[];
  // NV bị HR khóa tài khoản: BOT không xếp ca mới (Lịch ẩn NV này).
  const lockedIds = new Set<string>();
  try {
    const accs = await repo.listAccounts().catch(() => []);
    for (const a of accs || []) {
      if ((a as any)?.account_status === 'LOCKED' && (a as any)?.employee_id) {
        lockedIds.add(String((a as any).employee_id));
      }
    }
  } catch { /* bỏ qua: mặc định không khóa */ }
  const officials = (Array.isArray(employees) ? employees : []).filter(
    (e: any) =>
      e.employment_status === 'OFFICIAL' &&
      !lockedIds.has(String(e.employee_id)) &&
      (branchId === '*' || sameBranch(e.default_branch_id, branchId))
  );

  const noShift = officials.filter((e: any) => !e.default_shift_code || !ACTIVE_SHIFTS.includes(e.default_shift_code));
  const schedulable = officials.filter((e: any) => e.default_shift_code && ACTIVE_SHIFTS.includes(e.default_shift_code));

  const leaves = (await repo.listLeaveRequests(branchId === '*' ? undefined : branchId).catch(() => [])) as any[];
  const offByEmp = new Map<string, Set<string>>();
  const addOff = (empId: string, date: string) => {
    if (!offByEmp.has(empId)) offByEmp.set(empId, new Set());
    offByEmp.get(empId)!.add(date);
  };
  for (const l of leaves || []) {
    if (branchId !== '*' && !sameBranch((l as any).branch_id, branchId)) continue;
    const reqDate = (l as any).requested_date;
    if (!reqDate || reqDate < weekMon || reqDate > weekSun) continue;
    if ((l as any).leave_type === 'HANG_TUAN' && isValidOff((l as any).status)) {
      addOff((l as any).employee_id, reqDate);
    } else if ((l as any).leave_type === 'DOT_XUAT' && (l as any).status === 'APPROVED') {
      addOff((l as any).employee_id, reqDate);
    }
  }

  // Ca đã có (tay hoặc BOT lần trước): BOT không đụng vào.
  // NGOẠI LỆ: ca của NV THỬ VIỆC không chiếm slot chính thức (quy tắc 6) —
  // lịch thử việc (7 ngày làm tự xếp) và lịch chính thức độc lập nhau.
  const probationIds = new Set<string>(
    (Array.isArray(employees) ? employees : [])
      .filter((e: any) => e.employment_status === 'PROBATION')
      .map((e: any) => String(e.employee_id))
  );
  const existingRaw = (await repo.getShiftsForWeek(branchId, weekMon).catch(() => [])) as any[];
  const existing = (existingRaw || []).filter((s: any) => branchId === '*' || sameBranch((s as any).branch_id, branchId));
  const occupiedShiftDay = new Set<string>(); // `${shift}|${date}`
  const empDay = new Set<string>(); // `${emp}|${date}`
  const weeklyCount = new Map<string, number>();
  for (const s of existing || []) {
    if ((s as any).status === 'CANCELLED') continue;
    if (probationIds.has(String((s as any).employee_id))) continue;
    if ((s as any).date < weekMon || (s as any).date > weekSun) continue;
    occupiedShiftDay.add(`${(s as any).shift_code}|${(s as any).date}`);
    const k = `${(s as any).employee_id}|${(s as any).date}`;
    if (!empDay.has(k)) {
      empDay.add(k);
      weeklyCount.set((s as any).employee_id, (weeklyCount.get((s as any).employee_id) || 0) + 1);
    }
  }

  // Ngày công tháng (theo tháng dương lịch chứa TỪNG ngày xếp) — BOT ưu tiên bù cho người thiếu.
  // Đếm theo ngày duy nhất (2 ca/ngày chỉ tính 1 ngày công).
  const monthDays = new Map<string, Map<string, Set<string>>>(); // emp -> (yyyy-MM -> dates)
  const bumpMonth = (empId: string, date: string) => {
    const key = date.slice(0, 7);
    if (!monthDays.has(empId)) monthDays.set(empId, new Map());
    const m = monthDays.get(empId)!;
    if (!m.has(key)) m.set(key, new Set());
    m.get(key)!.add(date);
  };
  const monthFirstByKey = new Map<string, string>();
  for (const d of dates) {
    const mr = monthRangeOf(d);
    if (!monthFirstByKey.has(mr.key)) monthFirstByKey.set(mr.key, mr.first);
  }
  for (const mrKey of monthFirstByKey.keys()) {
    const mr = monthRangeOf(`${mrKey}-15`);
    const monthShiftsRaw = (await repo.getShiftsForWeek(branchId, mr.first).catch(() => [])) as any[];
    for (const s of monthShiftsRaw || []) {
      if ((s as any).status === 'CANCELLED') continue;
      if (branchId !== '*' && !sameBranch((s as any).branch_id, branchId)) continue;
      if ((s as any).date < mr.first || (s as any).date > mr.last) continue;
      bumpMonth((s as any).employee_id, (s as any).date);
    }
  }

  const items: AutoPlanItem[] = [];
  const warnings: AutoPlanWarning[] = [];
  for (const e of noShift) {
    warnings.push({
      employee_id: (e as any).employee_id,
      message: `${(e as any).full_name || (e as any).employee_id} chưa gán ca cố định — BOT bỏ qua, HR/Store gán ca rồi PUBLISH lại.`,
    });
  }

  const monthCountOf = (empId: string, date: string): number =>
    monthDays.get(empId)?.get(date.slice(0, 7))?.size || 0;

  for (const date of dates) {
    for (const shift of ACTIVE_SHIFTS) {
      if (occupiedShiftDay.has(`${shift}|${date}`)) continue; // đã có ca tay — giữ nguyên
      const pool = schedulable.filter((e: any) => branchId === '*' || sameBranch(e.default_branch_id, branchId));
      const candidates = pool.filter(
        (e: any) =>
          e.default_shift_code === shift &&
          !offByEmp.get(e.employee_id)?.has(date) &&
          !empDay.has(`${e.employee_id}|${date}`)
      );
      if (candidates.length === 0) {
        // Chỉ cảnh báo khi ca này có người phụ trách mà hôm đó không ai trực được.
        const hasOwner = pool.some((e: any) => e.default_shift_code === shift);
        if (hasOwner) {
          warnings.push({ date, shift_code: shift, message: `${date} ca ${shift}: không có người trực được (OFF hết hoặc đã có ca khác) — cần HR xếp tay.` });
        }
        continue;
      }
      candidates.sort((a: any, b: any) => {
        const dm = monthCountOf(a.employee_id, date) - monthCountOf(b.employee_id, date);
        if (dm !== 0) return dm; // ưu tiên bù ngày công tháng (tối thiểu 12 ngày/tháng)
        const dw = (weeklyCount.get(a.employee_id) || 0) - (weeklyCount.get(b.employee_id) || 0);
        if (dw !== 0) return dw; // rồi chia đều trong tuần (3/4)
        return String(a.employee_id).localeCompare(String(b.employee_id));
      });
      const pick = candidates[0];
      items.push({
        employee_id: pick.employee_id,
        employee_name: pick.full_name || pick.employee_id,
        branch_id: canonicalBranch(pick.default_branch_id) || branchId,
        shift_code: shift,
        date,
      });
      empDay.add(`${pick.employee_id}|${date}`);
      weeklyCount.set(pick.employee_id, (weeklyCount.get(pick.employee_id) || 0) + 1);
      bumpMonth(pick.employee_id, date);
      occupiedShiftDay.add(`${shift}|${date}`);
    }
  }

  const statMonthKey = weekMon.slice(0, 7);
  const statMonthKey2 = weekSun.slice(0, 7) !== statMonthKey ? weekSun.slice(0, 7) : undefined;
  const stats: AutoPlanEmpStat[] = schedulable
    .filter((e: any) => branchId === '*' || sameBranch(e.default_branch_id, branchId))
    .map((e: any) => ({
      employee_id: e.employee_id,
      employee_name: e.full_name || e.employee_id,
      shift_code: e.default_shift_code,
      weekly_days: weeklyCount.get(e.employee_id) || 0,
      monthly_days: monthDays.get(e.employee_id)?.get(statMonthKey)?.size || 0,
      monthly_key: statMonthKey,
      ...(statMonthKey2
        ? {
            monthly_days_2: monthDays.get(e.employee_id)?.get(statMonthKey2)?.size || 0,
            monthly_key_2: statMonthKey2,
          }
        : {}),
    }))
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'vi'));

  return { weekMon, weekSun, branchId, items, warnings, stats };
}

export class AutoScheduleService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  async plan(branchId: string, weekMon: string): Promise<AutoPlanResult> {
    return buildAutoPlan(this.repo, branchId, weekMon);
  }

  /** Ghi các ca BOT xếp ở trạng thái DRAFT (PUBLISH riêng sẽ duyệt toàn bộ). */
  async execute(branchId: string, weekMon: string, actorId: string): Promise<AutoPlanResult & { created: number }> {
    const plan = await buildAutoPlan(this.repo, branchId, weekMon);
    if (plan.items.length === 0) return { ...plan, created: 0 };
    const created = await singleWriterQueue.enqueue({
      entityType: 'PHAN_CONG_CA',
      entityId: `AUTO_${branchId}_${plan.weekMon}`,
      actorId,
      execute: async () => {
        const out: any[] = [];
        for (const it of plan.items) {
          const template = SHIFT_TEMPLATES[it.shift_code];
          const sh = String(template.start_hour).padStart(2, '0');
          const eh = String(template.end_hour).padStart(2, '0');
          out.push(
            await this.repo.createShiftAssignment({
              assignment_id: `SHIFT_AUTO_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
              employee_id: it.employee_id,
              branch_id: it.branch_id,
              shift_code: it.shift_code,
              date: it.date,
              start_at: `${it.date}T${sh}:00:00+07:00`,
              end_at: `${it.date}T${eh}:00:00+07:00`,
              status: 'DRAFT',
              schedule_version: 1,
            })
          );
        }
        return out;
      },
    });
    const list = (created as any)?.result ?? created;
    return { ...plan, created: Array.isArray(list) ? list.length : plan.items.length };
  }
}
