/**
 * SalaryConfigService — Cấu hình LƯƠNG CƠ BẢN + PHỤ CẤP theo TỪNG nhân viên,
 * áp dụng cho cả 4 khối: Cửa hàng (STORE) / Xưởng SX (XUONG) / Văn phòng (VAN_PHONG) / Sales (SALE).
 *
 * Quy tắc nghiệp vụ (theo quyết định của chủ dự án 2026-11):
 *  - HR (và Admin) được thêm hồ sơ nhân viên mới nhưng KHÔNG được đặt lương.
 *  - Kế toán (FINANCE) + Admin cấu hình cho từng NV:
 *      · Hình thức lương (pay_mode): STORE = theo ca (cố định) | VAN_PHONG = theo tháng (cố định)
 *        | XUONG/SALE = tùy chọn theo ca/theo tháng (mặc định XUONG: theo ca, SALE: theo tháng).
 *      · Lương cơ bản (đ/tháng — chỉ có ý nghĩa với hình thức theo THÁNG).
 *      · Phụ cấp (đ/tháng — mọi hình thức).
 *      · Lương 1 NV = (theo tháng: LBH + phụ cấp) else (giờ × rate) + phụ cấp.
 *  - Cấu hình là hồ sơ gốc — kỳ lương tự lấy LBH cấu hình làm MẶC ĐỊNH (kế toán vẫn nhập tay ghi đè được tại tab Tính Lương).
 *
 * Bền vững: lưu trong CÀI ĐẶT HỆ THỐNG (CAU_HINH_HE_THONG trên Google Sheets)
 * theo đúng mẫu office_benefits — KHÔNG đổi schema tab NHAN_VIEN_MASTER.
 */
import {
  effectivePayMode,
  isPayModeLockedToGroup,
  normalizePayMode,
  type PayMode,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';

const SETTINGS_KEY_SALARY_CONFIG = 'employee_salary_config';
const SETTINGS_KEY_OFFICE_BENEFITS = 'office_benefits';
const SETTINGS_KEY_BENEFITS_MERGED = 'office_benefits_merged_v1';

export interface SalaryConfigEntry {
  /** Hình thức lương riêng NV (chỉ XUONG/SALE; STORE/VAN_PHONG luôn bị ép theo khối). */
  pay_mode?: PayMode;
  /** Lương cơ bản (đ/tháng) — chỉ áp dụng khi hình thức = MONTHLY. */
  base_salary: number;
  /** Phụ cấp (đ/tháng) — mọi hình thức. */
  allowance: number;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: string;
}

export type SalaryConfigMap = Record<string, SalaryConfigEntry>;

export interface SheetPushResult {
  ok: boolean;
  at: string;
  error?: string;
  skipped?: string;
  pending?: boolean;
}

/** Serialize read-modify-write settings: 2 thao tác cùng lúc không ghi đè nhau. */
let salaryConfigLock: Promise<unknown> = Promise.resolve();
function withSalaryConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = salaryConfigLock.then(fn, fn);
  salaryConfigLock = run.then(() => undefined, () => undefined);
  return run;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), Math.max(1000, ms));
    (timer as any)?.unref?.();
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

function sanitizeEntry(raw: any): SalaryConfigEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const base = Math.floor(Number(raw.base_salary ?? raw.baseSalary) || 0);
  const allowance = Math.floor(Number(raw.allowance) || 0);
  if (!Number.isFinite(base) || !Number.isFinite(allowance)) return null;
  const payMode = normalizePayMode(raw.pay_mode ?? raw.payMode);
  return {
    ...(payMode ? { pay_mode: payMode } : {}),
    base_salary: Math.max(0, Math.min(base, 1_000_000_000)),
    allowance: Math.max(0, Math.min(allowance, 1_000_000_000)),
    ...(raw.updatedBy ? { updatedBy: String(raw.updatedBy) } : {}),
    ...(raw.updatedByName ? { updatedByName: String(raw.updatedByName) } : {}),
    ...(raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {}),
  };
}

export class SalaryConfigService {
  constructor(private repo: ISheetsRepository) {}

  private async readSettings(): Promise<any> {
    return (await this.repo.getSystemSettings().catch(() => ({}))) || {};
  }

  private async readMap(): Promise<SalaryConfigMap> {
    const settings = await this.readSettings();
    const raw = settings?.[SETTINGS_KEY_SALARY_CONFIG];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const map: SalaryConfigMap = {};
    for (const [employeeId, entryRaw] of Object.entries(raw)) {
      const entry = sanitizeEntry(entryRaw);
      if (entry) map[String(employeeId)] = entry;
    }
    return map;
  }

  /** Toàn bộ cấu hình lương theo employee_id — dùng cho Kế toán/Admin (HR chỉ xem). */
  async getAll(): Promise<SalaryConfigMap> {
    return this.readMap();
  }

  async getForEmployee(employeeId: string): Promise<SalaryConfigEntry | null> {
    const map = await this.readMap();
    return map[String(employeeId)] || null;
  }

  /** Hình thức lương hiệu lực của 1 NV (STORE/VAN_PHONG ép theo khối; XUONG/SALE theo cấu hình). */
  static resolvePayMode(group: unknown, cfg?: SalaryConfigEntry | null): PayMode {
    return effectivePayMode(group, cfg?.pay_mode);
  }

  /** Kế toán / Admin đặt hình thức lương + LBH + phụ cấp cho 1 NV.
   *  `group` (nếu truyền) quyết định pay_mode có được phép lưu hay không (STORE/VAN_PHONG: bỏ qua). */
  async setForEmployee(
    employeeId: string,
    data: { payMode?: string | null; baseSalary?: number; allowance?: number },
    actor?: { id?: string; name?: string },
    opts?: { group?: string },
  ): Promise<SalaryConfigEntry> {
    const base = Math.floor(Number(data.baseSalary) || 0);
    const allowance = Math.floor(Number(data.allowance) || 0);
    if (!Number.isFinite(base) || !Number.isFinite(allowance) || base < 0 || allowance < 0) {
      throw new Error('INVALID_SALARY_CONFIG: Lương cơ bản / phụ cấp phải là số ≥ 0.');
    }
    if (base > 1_000_000_000 || allowance > 1_000_000_000) {
      throw new Error('INVALID_SALARY_CONFIG: Giá trị lương vượt quá giới hạn cho phép (1 tỷ đ).');
    }
    const group = opts?.group ? String(opts.group).trim().toUpperCase() : undefined;
    const payMode = normalizePayMode(data.payMode);
    return withSalaryConfigLock(async () => {
      const map = await this.readMap();
      const prev = map[String(employeeId)];
      // Chỉ lưu pay_mode cho XUONG/SALE; STORE/VAN_PHONG luôn ép theo khối.
      const keepPayMode = group && isPayModeLockedToGroup(group) ? undefined : (payMode ?? prev?.pay_mode);
      const entry: SalaryConfigEntry = {
        ...(keepPayMode ? { pay_mode: keepPayMode } : {}),
        base_salary: base,
        allowance,
        updatedBy: actor?.id ? String(actor.id) : undefined,
        updatedByName: actor?.name ? String(actor.name) : undefined,
        updatedAt: new Date().toISOString(),
      };
      map[String(employeeId)] = entry;
      await this.repo.updateSystemSettings({ [SETTINGS_KEY_SALARY_CONFIG]: map });

      // XÁC MINH ĐÃ GHI: không bao giờ trả "lưu thành công" nếu dữ liệu đọc lại
      // không khớp (bộ nhớ hoặc PostgreSQL). Đây là lớp chống "báo thành công giả".
      const readBackMap = await this.readMap();
      const readBack = readBackMap[String(employeeId)];
      const mismatch =
        !readBack ||
        Number(readBack.base_salary) !== entry.base_salary ||
        Number(readBack.allowance) !== entry.allowance ||
        String(readBack.updatedAt || '') !== String(entry.updatedAt || '') ||
        (entry.pay_mode ? readBack.pay_mode !== entry.pay_mode : false);
      if (mismatch) {
        throw new Error('SALARY_CONFIG_NOT_PERSISTED: Hệ thống chưa xác minh được cấu hình vừa lưu — dữ liệu KHÔNG được coi là thành công.');
      }

      // Chế độ PostgreSQL: đọc lại đúng bản ghi app_settings để chắc chắn DB đã ghi.
      const store: any = (this.repo as any)?.store;
      if (store?.configured && typeof store.getSetting === 'function') {
        try {
          const persisted = await store.getSetting('systemSettings');
          const row = persisted?.[SETTINGS_KEY_SALARY_CONFIG]?.[String(employeeId)];
          if (row && String(row.updatedAt || '') !== String(entry.updatedAt || '')) {
            throw new Error('SALARY_CONFIG_NOT_PERSISTED: Bản ghi PostgreSQL chưa khớp cấu hình vừa lưu.');
          }
        } catch (verifyErr: any) {
          if (String(verifyErr?.message || '').includes('SALARY_CONFIG_NOT_PERSISTED')) throw verifyErr;
          // Lỗi đọc lại DB (không phải lệch dữ liệu): updateSystemSettings đã await
          // persistMutation thành công nên vẫn coi là đã lưu; chỉ ghi log để chẩn đoán.
          console.warn('[salary-config] Không đọc lại được app_settings để xác minh:', verifyErr?.message || verifyErr);
        }
      }
      return entry;
    });
  }

  /**
   * Đẩy cấu hình (employee_salary_config) lên Google Sheets NGAY và trả về kết quả
   * thật. Dùng trong API lưu lương để UI biết Sheet đã đồng bộ hay đang lỗi.
   */
  async pushToGoogleSheets(): Promise<SheetPushResult> {
    const sync: any = (this.repo as any)?.syncService || (this.repo as any)?.fallbackAdapter?.syncService;
    if (!sync || typeof sync.pushSystemSettingsNow !== 'function') {
      return { ok: true, at: new Date().toISOString(), skipped: 'SHEETS_NOT_CONFIGURED' };
    }
    try {
      const res = await withTimeout<SheetPushResult>(sync.pushSystemSettingsNow(this.repo), 15_000);
      return res && typeof res === 'object'
        ? res
        : { ok: false, at: new Date().toISOString(), error: 'SHEET_SYNC_INVALID_RESULT' };
    } catch (e: any) {
      const timeout = String(e?.message || '') === 'TIMEOUT';
      return {
        ok: false,
        at: new Date().toISOString(),
        error: timeout ? 'SHEETS_TIMEOUT' : String(e?.message || e).slice(0, 300),
        pending: timeout,
      };
    }
  }

  /**
   * Migrate MỘT LẦN dữ liệu "Phúc lợi VP" (office_benefits, do HR từng sửa) gộp vào
   * phụ cấp của cấu hình lương mới. Idempotent — chạy 1 lần duy nhất.
   * Quy tắc: allowance cũ = 0/chưa có -> đặt bằng giá trị phúc lợi cũ; nếu kế toán đã
   * cấu hình phụ cấp rồi thì GIỮ NGUYÊN (không ghi đè).
   */
  async migrateLegacyOfficeBenefits(): Promise<void> {
    const settings = await this.readSettings();
    if (settings && settings[SETTINGS_KEY_BENEFITS_MERGED] === true) return;
    const legacy = settings?.[SETTINGS_KEY_OFFICE_BENEFITS];
    const legacyMap: Record<string, number> = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : {};
    const targets = Object.entries(legacyMap)
      .map(([id, v]) => [String(id), Math.max(0, Math.floor(Number(v) || 0))] as const)
      .filter(([, v]) => v > 0);

    await withSalaryConfigLock(async () => {
      const freshSettings = await this.readSettings();
      if (freshSettings && freshSettings[SETTINGS_KEY_BENEFITS_MERGED] === true) return;
      const map = await this.readMap();
      let changed = false;
      for (const [employeeId, benefits] of targets) {
        const prev = map[employeeId];
        if (prev && Number(prev.allowance) > 0) continue; // kế toán đã cấu hình — giữ nguyên
        map[employeeId] = {
          ...(prev?.pay_mode ? { pay_mode: prev.pay_mode } : {}),
          base_salary: Math.max(0, Math.floor(Number(prev?.base_salary) || 0)),
          allowance: benefits,
          updatedBy: 'SYSTEM_MIGRATE',
          updatedByName: 'Migrate phúc lợi VP',
          updatedAt: new Date().toISOString(),
        };
        changed = true;
      }
      await this.repo.updateSystemSettings({
        ...(changed ? { [SETTINGS_KEY_SALARY_CONFIG]: map } : {}),
        [SETTINGS_KEY_OFFICE_BENEFITS]: {},
        [SETTINGS_KEY_BENEFITS_MERGED]: true,
      });
    });
  }
}
