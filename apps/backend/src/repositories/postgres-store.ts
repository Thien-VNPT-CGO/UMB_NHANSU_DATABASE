import { PoolClient } from 'pg';
import { MockSheetsAdapter } from './mock-sheets.adapter.js';
import { isPostgresConfigured, pgQuery, withTransaction } from '../config/database.js';

/**
 * Lớp lưu trữ PostgreSQL cho toàn bộ kho dữ liệu nghiệp vụ.
 *
 * Thiết kế: mỗi collection (nhân viên, ca, chấm công, lương...) là 1 bảng
 * `(id, data jsonb, bucket_month, created_at, updated_at)`. Dữ liệu nghiệp vụ
 * giữ nguyên shape hiện tại trong `data`; các cột phụ chỉ phục vụ archive/index.
 *
 * PostgreSQL là nguồn sự thật: mỗi mutation được ghi xuống DB trước khi API trả
 * về. Bộ nhớ (MockSheetsAdapter) là cache làm việc, được nạp lại khi khởi động.
 */

interface CollectionDef {
  key: string;
  table: string;
  id: (row: any) => string;
  bucketMonth?: (row: any) => string | null;
}

const TABLES = {
  accounts: 'employee_accounts',
  adminAccounts: 'admin_accounts',
  employees: 'employees',
  stageHistories: 'employee_stage_history',
  candidates: 'candidate_applications',
  shifts: 'shift_assignments',
  leaveRequests: 'leave_requests',
  swapRequests: 'swap_requests',
  attendanceEvents: 'attendance_events',
  attendanceAdjustments: 'attendance_adjustments',
  payrollRuns: 'payroll_runs',
  payslips: 'payslips',
  payrollFormulas: 'payroll_formulas',
  payrollInputs: 'payroll_inputs',
  notificationOutbox: 'notification_outbox',
  notificationInbox: 'notification_inbox',
  testPapers: 'test_papers',
  testSubmissions: 'test_submissions',
  operations: 'operations',
  auditLogs: 'audit_logs',
  branches: 'branches',
  backupSnapshots: 'backup_snapshots',
} as const;

type CollectionKey = keyof typeof TABLES;

function str(value: unknown): string {
  return String(value ?? '').trim();
}

function monthOf(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  // "YYYY-MM" (kỳ lương) hoặc "YYYY-MM-DD..."
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const t = Date.parse(raw.length <= 10 ? `${raw}T00:00:00+07:00` : raw);
    if (!Number.isFinite(t)) return `${raw.slice(0, 7)}-01`;
    return `${new Date(t + 7 * 3_600_000).toISOString().slice(0, 7)}-01`;
  }
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return `${new Date(t + 7 * 3_600_000).toISOString().slice(0, 7)}-01`;
}

function tsOf(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const COLLECTIONS: CollectionDef[] = [
  { key: 'accounts', table: TABLES.accounts, id: r => str(r.account_id) },
  { key: 'adminAccounts', table: TABLES.adminAccounts, id: r => str(r.admin_id) },
  { key: 'employees', table: TABLES.employees, id: r => str(r.employee_id) },
  { key: 'stageHistories', table: TABLES.stageHistories, id: r => str(r.period_id) },
  { key: 'candidates', table: TABLES.candidates, id: r => str(r.submission_id) },
  {
    key: 'shifts',
    table: TABLES.shifts,
    id: r => str(r.assignment_id),
    bucketMonth: r => monthOf(r.date),
  },
  {
    key: 'leaveRequests',
    table: TABLES.leaveRequests,
    id: r => str(r.request_id),
    bucketMonth: r => monthOf(r.requested_date || r.created_at),
  },
  {
    key: 'swapRequests',
    table: TABLES.swapRequests,
    id: r => str(r.swap_id),
    bucketMonth: r => monthOf(r.created_at),
  },
  {
    key: 'attendanceEvents',
    table: TABLES.attendanceEvents,
    id: r => str(r.event_id),
    bucketMonth: r => monthOf(r.server_received_at || r.client_time || r.created_at),
  },
  {
    key: 'attendanceAdjustments',
    table: TABLES.attendanceAdjustments,
    id: r => str(r.adjustment_id),
    bucketMonth: r => monthOf(r.created_at),
  },
  {
    key: 'payrollRuns',
    table: TABLES.payrollRuns,
    id: r => str(r.run_id),
    bucketMonth: r => monthOf(r.period),
  },
  {
    key: 'payslips',
    table: TABLES.payslips,
    id: r => str(r.item_id),
    bucketMonth: r => monthOf(r.period),
  },
  {
    key: 'payrollFormulas',
    table: TABLES.payrollFormulas,
    id: r => str(r.period),
  },
  {
    key: 'payrollInputs',
    table: TABLES.payrollInputs,
    id: r => `${str(r.period)}:${str(r.employee_id)}`,
    bucketMonth: r => monthOf(r.period),
  },
  {
    key: 'notificationOutbox',
    table: TABLES.notificationOutbox,
    id: r => str(r.notification_id),
    bucketMonth: r => monthOf(r.created_at),
  },
  {
    key: 'notificationInbox',
    table: TABLES.notificationInbox,
    id: r => str(r.inbox_id),
    bucketMonth: r => monthOf(r.created_at),
  },
  { key: 'testPapers', table: TABLES.testPapers, id: r => str(r.test_id) },
  { key: 'testSubmissions', table: TABLES.testSubmissions, id: r => str(r.submission_id) },
  {
    key: 'operations',
    table: TABLES.operations,
    id: r => str(r.operation_id),
    bucketMonth: r => monthOf(r.created_at),
  },
  {
    key: 'auditLogs',
    table: TABLES.auditLogs,
    id: r => str(r.log_id),
    bucketMonth: r => monthOf(r.timestamp),
  },
  { key: 'branches', table: TABLES.branches, id: r => str(r.id || r.branch_id) },
  { key: 'backupSnapshots', table: TABLES.backupSnapshots, id: r => str(r.snapshot_id) },
];

const SINGLETON_KEYS = ['shiftTemplates', 'policies', 'maintenance', 'systemSettings'] as const;

/**
 * Ảnh/base64 KHÔNG được lưu vào PostgreSQL (yêu cầu kiến trúc).
 * Các trường ảnh điểm danh/bằng chứng/avatar được upload Drive (hoặc đĩa VPS
 * khi Drive lỗi) và DB chỉ giữ id/tham chiếu (`drive_object_id`, ...).
 */
const PHOTO_PAYLOAD_FIELDS = new Set([
  'photo_base64',
  'event_photo',
  'avatar_photo',
  'evidence_photo',
]);

function serializeRow(row: any): string {
  return JSON.stringify(row, (key, value) => (
    PHOTO_PAYLOAD_FIELDS.has(key) ? undefined : value
  ));
}

/** Dòng backup có thể phục hồi: giữ id + data + mốc thời gian gốc. */
export interface BackupLineRecord {
  t: string;
  i: string;
  b?: string | null;
  c?: string | null;
  u?: string | null;
  d: any;
}

export interface BackupExportResult {
  jsonl: string;
  counts: Record<string, number>;
  total: number;
  tables: string[];
  createdAt: string;
}

const INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance_events ((data->>'employee_id'))`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_request ON attendance_events ((data->>'request_id'))`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_time ON attendance_events ((data->>'server_received_at'))`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_bucket ON attendance_events (bucket_month)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs ((data->>'timestamp'))`,
  `CREATE INDEX IF NOT EXISTS idx_audit_bucket ON audit_logs (bucket_month)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_recipient ON notification_inbox ((data->>'recipient_id'))`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_bucket ON notification_inbox (bucket_month)`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_bucket ON notification_outbox (bucket_month)`,
  `CREATE INDEX IF NOT EXISTS idx_shifts_employee_date ON shift_assignments ((data->>'employee_id'), (data->>'date'))`,
  `CREATE INDEX IF NOT EXISTS idx_shifts_branch_date ON shift_assignments ((data->>'branch_id'), (data->>'date'))`,
  `CREATE INDEX IF NOT EXISTS idx_leaves_employee_date ON leave_requests ((data->>'employee_id'), (data->>'requested_date'))`,
  `CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips ((data->>'run_id'))`,
  `CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips ((data->>'employee_id'))`,
  `CREATE INDEX IF NOT EXISTS idx_employees_phone ON employees ((data->>'phone_normalized'))`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_phone ON employee_accounts ((data->>'phone_normalized'))`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_phone ON candidate_applications ((data->>'phone_normalized'))`,
  `CREATE INDEX IF NOT EXISTS idx_operations_idem ON operations ((data->>'idempotency_key'))`,
];

export class PostgresStore {
  public readonly configured = isPostgresConfigured();
  private persistedAuditIds = new Set<string>();

  public async initSchema(): Promise<void> {
    if (!this.configured) return;
    await withTransaction(async client => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key text PRIMARY KEY,
          data jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS archive_manifests (
          id bigserial PRIMARY KEY,
          table_name text NOT NULL,
          period_start date NOT NULL,
          period_end date NOT NULL,
          row_count bigint NOT NULL,
          file_url text NOT NULL,
          checksum text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      for (const def of COLLECTIONS) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${def.table} (
            id text PRIMARY KEY,
            data jsonb NOT NULL,
            bucket_month date,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `);
      }
      for (const sql of INDEXES) await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations(key) VALUES ($1) ON CONFLICT (key) DO NOTHING`,
        ['postgres_v1'],
      );
    });
    console.log('[PostgresStore] Schema sẵn sàng.');
  }

  /** Nạp toàn bộ dữ liệu DB vào bộ nhớ. Trả về false nếu DB trống. */
  public async loadAll(inner: MockSheetsAdapter): Promise<{ loaded: boolean; counts: Record<string, number> }> {
    if (!this.configured) return { loaded: false, counts: {} };
    const counts: Record<string, number> = {};
    let total = 0;

    const loadedRows: Record<string, any[]> = {};
    for (const def of COLLECTIONS) {
      const res = await pgQuery(`SELECT data FROM ${def.table} ORDER BY created_at ASC, id ASC`);
      const rows = res.rows.map(r => r.data);
      loadedRows[def.key] = rows;
      counts[def.key] = rows.length;
      total += rows.length;
    }

    // Chỉ thay thế bộ nhớ khi DB thật sự có dữ liệu. DB trống => giữ seed dev.
    if (total > 0) {
      for (const def of COLLECTIONS) {
        (inner as any)[def.key] = loadedRows[def.key] || [];
      }
      // audit log mới nhất ở đầu, giống hành vi trong bộ nhớ
      inner.auditLogs.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      inner.notificationInbox.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      inner.notificationOutbox.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    }

    const settings = await pgQuery(`SELECT key, data FROM app_settings`);
    for (const row of settings.rows) {
      const key = String(row.key);
      if ((SINGLETON_KEYS as readonly string[]).includes(key)) {
        (inner as any)[key] = row.data;
      } else if (key === 'terminatedRevoked' && Array.isArray(row.data)) {
        inner.terminatedRevoked = new Set(row.data.map((x: any) => String(x)));
      }
    }

    this.persistedAuditIds = new Set(inner.auditLogs.map(x => String(x.log_id)).filter(Boolean));
    return { loaded: total > 0 || settings.rows.length > 0, counts };
  }

  /** Ghi toàn bộ trạng thái bộ nhớ xuống DB (migration / seed lần đầu). */
  public async persistAll(inner: MockSheetsAdapter): Promise<void> {
    if (!this.configured) return;
    await withTransaction(async client => {
      for (const def of COLLECTIONS) {
        const rows = ((inner as any)[def.key] || []) as any[];
        await this.upsertRows(def, rows, client);
      }
      for (const key of SINGLETON_KEYS) {
        await this.upsertSetting(key, (inner as any)[key] || {}, client);
      }
      await this.upsertSetting('terminatedRevoked', Array.from(inner.terminatedRevoked), client);
    });
    this.persistedAuditIds = new Set(inner.auditLogs.map(x => String(x.log_id)).filter(Boolean));
    console.log('[PostgresStore] Đã ghi toàn bộ trạng thái xuống PostgreSQL.');
  }

  /**
   * Migration: xóa sạch dữ liệu cũ rồi ghi toàn bộ trạng thái mới.
   * CHỈ dùng khi backend đã dừng (script migrate) để tránh race với request.
   */
  public async replaceAll(inner: MockSheetsAdapter): Promise<void> {
    if (!this.configured) return;
    const tables = COLLECTIONS.map(def => def.table).join(', ');
    await withTransaction(async client => {
      await client.query(`TRUNCATE TABLE ${tables}`);
      await client.query(`TRUNCATE TABLE app_settings`);
    });
    this.persistedAuditIds.clear();
    await this.persistAll(inner);
  }

  /**
   * Ghi thay đổi của 1 method nghiệp vụ. Được gọi sau khi MockSheetsAdapter
   * đã cập nhật bộ nhớ; mọi thứ nằm trong 1 transaction.
   */
  public async persistMutation(
    method: string,
    args: any[],
    result: any,
    inner: MockSheetsAdapter,
  ): Promise<void> {
    if (!this.configured) return;
    await withTransaction(async client => {
      const upsert = async (key: CollectionKey, row: any) => {
        const def = COLLECTIONS.find(c => c.key === key)!;
        if (!row || !def.id(row)) return;
        await this.upsertRecord(def, row, client);
      };

      switch (method) {
        case 'createAccount':
        case 'setAccountPin':
        case 'markAccountPinMustChange':
        case 'setAccountStatus':
          await upsert('accounts', result);
          break;

        case 'createEmployee':
        case 'updateEmployee':
          await upsert('employees', result);
          break;

        case 'addStageHistory':
          await upsert('stageHistories', result);
          break;

        case 'createCandidate':
        case 'updateCandidate':
          await upsert('candidates', result);
          break;
        case 'deleteCandidate':
          await this.deleteRecord(TABLES.candidates, str(args[0]), client);
          break;

        case 'createShiftAssignment':
        case 'updateShiftAssignment':
          await upsert('shifts', result);
          break;
        case 'deleteShiftAssignment':
          await this.deleteRecord(TABLES.shifts, str(args[0]), client);
          break;
        case 'publishShiftAssignments': {
          const ids = new Set((args[0] || []).map((x: any) => str(x)));
          for (const shift of inner.shifts) {
            if (ids.has(str(shift.assignment_id))) await upsert('shifts', shift);
          }
          break;
        }
        case 'purgeShiftAssignments': {
          for (const id of args[0] || []) await this.deleteRecord(TABLES.shifts, str(id), client);
          break;
        }
        case 'deleteShiftsForEmployee':
          await this.reconcileCollection('shifts', inner, client);
          break;

        case 'createLeaveRequest':
        case 'updateLeaveRequest':
          await upsert('leaveRequests', result);
          break;

        case 'createSwapRequest':
        case 'updateSwapRequest':
          await upsert('swapRequests', result);
          break;

        case 'recordAttendanceEvent':
        case 'updateAttendanceEvent':
          await upsert('attendanceEvents', result);
          break;
        case 'deleteAttendanceEvent':
          await this.deleteRecord(TABLES.attendanceEvents, str(args[0]), client);
          break;

        case 'createAttendanceAdjustment':
        case 'updateAttendanceAdjustment':
          await upsert('attendanceAdjustments', result);
          break;
        case 'deleteAttendanceAdjustment':
          await this.deleteRecord(TABLES.attendanceAdjustments, str(args[0]), client);
          break;

        case 'createPayrollRun':
          await upsert('payrollRuns', result?.run);
          for (const item of result?.items || []) await upsert('payslips', item);
          break;
        case 'updatePayrollRunStatus':
          await upsert('payrollRuns', result);
          for (const slip of inner.payslips.filter(p => str(p.run_id) === str(result?.run_id))) {
            await upsert('payslips', slip);
          }
          break;
        case 'updatePayslip':
          await upsert('payslips', result);
          break;
        case 'savePayrollFormula':
          await upsert('payrollFormulas', result);
          break;
        case 'upsertPayrollInput':
          await upsert('payrollInputs', result);
          break;

        case 'createNotification':
          await upsert('notificationOutbox', result?.outbox);
          for (const inbox of result?.inboxes || []) await upsert('notificationInbox', inbox);
          break;
        case 'markNotificationRead':
        case 'markNotificationAcknowledged':
          await upsert('notificationInbox', result);
          break;
        case 'pruneNotifications':
          await this.reconcileCollection('notificationInbox', inner, client);
          await this.reconcileCollection('notificationOutbox', inner, client);
          break;

        case 'createTestPaper':
        case 'updateTestPaper':
          await upsert('testPapers', result);
          break;
        case 'createTestSubmission':
        case 'updateTestSubmission':
          await upsert('testSubmissions', result);
          break;

        case 'recordOperation':
        case 'updateOperation':
          await upsert('operations', result);
          break;

        case 'recordAuditLog':
          await upsert('auditLogs', result);
          break;

        case 'createAdminAccount':
        case 'updateAdminAccount':
          await upsert('adminAccounts', result);
          break;
        case 'deleteAdminAccount':
          await this.deleteRecord(TABLES.adminAccounts, str(args[0]), client);
          break;

        case 'updateBranch':
          await upsert('branches', result);
          break;

        case 'updateShiftTemplates':
          await this.upsertSetting('shiftTemplates', inner.shiftTemplates, client);
          await this.upsertSetting('systemSettings', inner.systemSettings, client);
          break;
        case 'updatePolicies':
          await this.upsertSetting('policies', inner.policies, client);
          await this.upsertSetting('systemSettings', inner.systemSettings, client);
          break;
        case 'updateMaintenance':
          await this.upsertSetting('maintenance', inner.maintenance, client);
          await this.upsertSetting('systemSettings', inner.systemSettings, client);
          break;
        case 'updateSystemSettings':
          await this.upsertSetting('systemSettings', inner.systemSettings, client);
          await this.upsertSetting('shiftTemplates', inner.shiftTemplates, client);
          await this.upsertSetting('policies', inner.policies, client);
          await this.upsertSetting('maintenance', inner.maintenance, client);
          break;

        case 'createBackupSnapshot':
          await upsert('backupSnapshots', result);
          break;

        case 'deleteEmployee':
          await this.deleteRecord(TABLES.employees, str(args[0]), client);
          // Xóa kèm tài khoản liên quan (khớp behavior bộ nhớ: employee_id hoặc account_id = id).
          await this.deleteByDataField(TABLES.accounts, 'employee_id', str(args[0]), client);
          await this.deleteRecord(TABLES.accounts, str(args[0]), client);
          break;
        case 'deleteAccount':
          await this.deleteRecord(TABLES.accounts, str(args[0]), client);
          break;

        default:
          // Read method hoặc method chưa cần persist riêng.
          break;
      }

      await this.persistNewAuditLogs(inner, client);
    });
  }

  /**
   * Xuất toàn bộ dữ liệu nghiệp vụ ra JSONL (mỗi dòng 1 bản ghi) để backup.
   * Không chứa ảnh/base64 vì DB vốn đã chỉ lưu metadata.
   *
   * Có thể loại trừ bảng nặng (audit/notification...) cho backup theo giờ để
   * file nhỏ; các kỳ daily/weekly/monthly vẫn full.
   */
  public async exportBackupJsonl(opts: { excludeTables?: string[] } = {}): Promise<BackupExportResult> {
    if (!this.configured) throw new Error('POSTGRES_NOT_CONFIGURED');
    const exclude = new Set((opts.excludeTables || []).map(x => str(x)).filter(Boolean));
    const createdAt = new Date().toISOString();
    const counts: Record<string, number> = {};
    const tables: string[] = [];
    const lines: string[] = [];

    for (const def of COLLECTIONS) {
      if (exclude.has(def.table) || exclude.has(def.key)) continue;
      const res = await pgQuery(
        `SELECT id, data, bucket_month::text AS bucket_month, created_at, updated_at
           FROM ${def.table} ORDER BY id ASC`,
      );
      counts[def.key] = res.rows.length;
      tables.push(def.table);
      for (const row of res.rows) {
        lines.push(JSON.stringify({
          t: def.key,
          i: String(row.id || ''),
          b: row.bucket_month || null,
          c: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || null),
          u: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at || null),
          d: row.data,
        }));
      }
    }

    const settings = await pgQuery(`SELECT key, data FROM app_settings ORDER BY key ASC`);
    counts.settings = settings.rows.length;
    for (const row of settings.rows) {
      lines.push(JSON.stringify({ t: '@settings', i: String(row.key), d: row.data }));
    }

    const header = JSON.stringify({ _ubm_backup: 1, created_at: createdAt, counts });
    return {
      jsonl: [header, ...lines].join('\n'),
      counts,
      total: lines.length,
      tables,
      createdAt,
    };
  }

  /**
   * Phục hồi từ JSONL do `exportBackupJsonl` tạo ra.
   *
   * CHỈ dùng khi backend đã dừng. Chỉ TRUNCATE đúng các bảng có trong file
   * (backup theo giờ có thể thiếu bảng nặng), nên có thể phục hồi từng phần.
   */
  public async restoreBackupJsonl(jsonl: string): Promise<{ counts: Record<string, number>; total: number }> {
    if (!this.configured) throw new Error('POSTGRES_NOT_CONFIGURED');
    const rowsByKey = new Map<string, BackupLineRecord[]>();
    const settings: Array<{ key: string; data: any }> = [];

    for (const raw of String(jsonl || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      let rec: any;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec?._ubm_backup) continue;
      if (rec?.t === '@settings') {
        if (rec.i) settings.push({ key: String(rec.i), data: rec.d ?? {} });
        continue;
      }
      const def = COLLECTIONS.find(c => c.key === rec?.t);
      if (!def) continue;
      const arr = rowsByKey.get(def.key) || [];
      arr.push(rec as BackupLineRecord);
      rowsByKey.set(def.key, arr);
    }

    if (rowsByKey.size === 0 && settings.length === 0) {
      throw new Error('BACKUP_FILE_EMPTY');
    }

    const counts: Record<string, number> = {};
    let total = 0;
    await withTransaction(async client => {
      const tables = [...rowsByKey.keys()].map(k => COLLECTIONS.find(c => c.key === k)!.table);
      if (tables.length) await client.query(`TRUNCATE TABLE ${tables.join(', ')}`);
      if (settings.length) await client.query(`TRUNCATE TABLE app_settings`);

      for (const [key, records] of rowsByKey) {
        const def = COLLECTIONS.find(c => c.key === key)!;
        await this.restoreRows(def, records, client);
        counts[key] = records.length;
        total += records.length;
      }
      for (const s of settings) await this.upsertSetting(s.key, s.data, client);
    });

    this.persistedAuditIds.clear();
    console.log(`[PostgresStore] Đã phục hồi ${total} bản ghi + ${settings.length} cấu hình từ backup.`);
    return { counts, total };
  }

  /** Đọc 1 cấu hình đơn lẻ từ app_settings (không đụng systemSettings). */
  public async getSetting<T = any>(key: string): Promise<T | null> {
    if (!this.configured) return null;
    const res = await pgQuery(`SELECT data FROM app_settings WHERE key = $1`, [key]);
    return (res.rows[0]?.data as T) ?? null;
  }

  /** Ghi 1 cấu hình đơn lẻ, không ghi đè các key khác. */
  public async saveSetting(key: string, value: any): Promise<void> {
    if (!this.configured) return;
    await this.upsertSetting(key, value);
  }

  private async restoreRows(def: CollectionDef, records: BackupLineRecord[], client: PoolClient): Promise<void> {
    const maxParams = 6000;
    const perRow = 5;
    const chunkSize = Math.max(1, Math.floor(maxParams / perRow));
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize).filter(r => str(r.i) && r.d && typeof r.d === 'object');
      if (!chunk.length) continue;
      const values: any[] = [];
      const placeholders: string[] = [];
      chunk.forEach((rec, idx) => {
        const base = idx * perRow;
        const row = rec.d || {};
        const bucket = rec.b || (def.bucketMonth ? def.bucketMonth(row) : null);
        const created = rec.c || tsOf(row.created_at || row.timestamp) || new Date().toISOString();
        const updated = rec.u || rec.c || tsOf(row.updated_at || row.created_at || row.timestamp) || created;
        values.push(String(rec.i), JSON.stringify(row), bucket || null, created, updated);
        placeholders.push(`($${base + 1}, $${base + 2}::jsonb, $${base + 3}::date, $${base + 4}::timestamptz, $${base + 5}::timestamptz)`);
      });
      await client.query(
        `INSERT INTO ${def.table} (id, data, bucket_month, created_at, updated_at)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           bucket_month = EXCLUDED.bucket_month,
           updated_at = EXCLUDED.updated_at`,
        values,
      );
    }
  }

  private async upsertRecord(def: CollectionDef, row: any, client?: PoolClient): Promise<void> {
    const id = def.id(row);
    if (!id) return;
    const data = serializeRow(row);
    const bucket = def.bucketMonth ? def.bucketMonth(row) : null;
    const created = tsOf(row.created_at || row.timestamp) || new Date().toISOString();
    const updated = tsOf(row.updated_at || row.created_at || row.timestamp) || created;
    const sql = `
      INSERT INTO ${def.table} (id, data, bucket_month, created_at, updated_at)
      VALUES ($1, $2::jsonb, $3::date, $4::timestamptz, $5::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data,
        bucket_month = EXCLUDED.bucket_month,
        updated_at = EXCLUDED.updated_at
    `;
    if (client) await client.query(sql, [id, data, bucket, created, updated]);
    else await pgQuery(sql, [id, data, bucket, created, updated]);
  }

  private async upsertRows(def: CollectionDef, rows: any[], client?: PoolClient): Promise<void> {
    const maxParams = 6000;
    const perRow = 5;
    const chunkSize = Math.max(1, Math.floor(maxParams / perRow));
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize).filter(r => def.id(r));
      if (!chunk.length) continue;
      const values: any[] = [];
      const placeholders: string[] = [];
      chunk.forEach((row, idx) => {
        const base = idx * perRow;
        const created = tsOf(row.created_at || row.timestamp) || new Date().toISOString();
        const updated = tsOf(row.updated_at || row.created_at || row.timestamp) || created;
        values.push(
          def.id(row),
          serializeRow(row),
          def.bucketMonth ? def.bucketMonth(row) : null,
          created,
          updated,
        );
        placeholders.push(`($${base + 1}, $${base + 2}::jsonb, $${base + 3}::date, $${base + 4}::timestamptz, $${base + 5}::timestamptz)`);
      });
      const sql = `
        INSERT INTO ${def.table} (id, data, bucket_month, created_at, updated_at)
        VALUES ${placeholders.join(',')}
        ON CONFLICT (id) DO UPDATE SET
          data = EXCLUDED.data,
          bucket_month = EXCLUDED.bucket_month,
          updated_at = EXCLUDED.updated_at
      `;
      if (client) await client.query(sql, values);
      else await pgQuery(sql, values);
    }
  }

  private async upsertSetting(key: string, value: any, client?: PoolClient): Promise<void> {
    const sql = `
      INSERT INTO app_settings (key, data, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    `;
    if (client) await client.query(sql, [key, JSON.stringify(value ?? {})]);
    else await pgQuery(sql, [key, JSON.stringify(value ?? {})]);
  }

  private async deleteRecord(table: string, id: string, client?: PoolClient): Promise<void> {
    if (!id) return;
    const sql = `DELETE FROM ${table} WHERE id = $1`;
    if (client) await client.query(sql, [id]);
    else await pgQuery(sql, [id]);
  }

  private async deleteByDataField(table: string, field: string, value: string, client?: PoolClient): Promise<void> {
    if (!/^[a-z_]+$/i.test(field) || !value) return;
    const sql = `DELETE FROM ${table} WHERE data->>'${field}' = $1`;
    if (client) await client.query(sql, [value]);
    else await pgQuery(sql, [value]);
  }

  private async reconcileCollection(
    key: CollectionKey,
    inner: MockSheetsAdapter,
    client?: PoolClient,
  ): Promise<void> {
    const def = COLLECTIONS.find(c => c.key === key)!;
    const rows = ((inner as any)[key] || []) as any[];
    const currentIds = new Set(rows.map(r => def.id(r)).filter(Boolean));
    const existing = client
      ? await client.query(`SELECT id FROM ${def.table}`)
      : await pgQuery(`SELECT id FROM ${def.table}`);
    const dbIds = new Set(existing.rows.map((r: any) => String(r.id)));
    for (const id of dbIds) {
      if (!currentIds.has(id)) await this.deleteRecord(def.table, id, client);
    }
    await this.upsertRows(def, rows, client);
  }

  private async persistNewAuditLogs(inner: MockSheetsAdapter, client?: PoolClient): Promise<void> {
    const def = COLLECTIONS.find(c => c.key === 'auditLogs')!;
    for (const entry of inner.auditLogs) {
      const id = def.id(entry);
      if (!id || this.persistedAuditIds.has(id)) break; // audit mới được unshift lên đầu
      await this.upsertRecord(def, entry, client);
      this.persistedAuditIds.add(id);
    }
  }
}
