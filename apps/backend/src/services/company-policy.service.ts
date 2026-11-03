import { randomUUID } from 'node:crypto';
import { ISheetsRepository } from '../repositories/sheets.interface.js';

/**
 * Quy chế công ty áp dụng vào hệ thống, chọn đối tượng áp dụng:
 *  - Từng nhân viên (EMPLOYEE)
 *  - Từng chi nhánh (BRANCH)
 *  - Tất cả nhân viên (ALL)
 *
 * Lưu trong system settings (không đổi schema Sheets), khóa `companyRegulations`.
 * Realtime: caller bắn data:updated('company-policies') sau mỗi thao tác.
 */
export type PolicyTargetType = 'ALL' | 'BRANCH' | 'EMPLOYEE';

export interface CompanyPolicyTarget {
  type: PolicyTargetType;
  branchIds?: string[];
  employeeIds?: string[];
}

export interface CompanyPolicy {
  policy_id: string;
  code: string;
  title: string;
  content: string;
  category: string;
  effective_from?: string;
  active: boolean;
  targets: CompanyPolicyTarget;
  created_at: string;
  updated_at: string;
  created_by: string;
  created_by_name?: string;
}

export const COMPANY_POLICY_KEY = 'companyRegulations';

let settingsLock: Promise<unknown> = Promise.resolve();
function withSettingsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = settingsLock.then(fn, fn);
  settingsLock = run.then(() => undefined, () => undefined);
  return run;
}

function normalizeTarget(raw: any): CompanyPolicyTarget {
  const type: PolicyTargetType = ['ALL', 'BRANCH', 'EMPLOYEE'].includes(raw?.type) ? raw.type : 'ALL';
  const arr = (v: any) => Array.isArray(v) ? v.map((x: any) => String(x)).filter(Boolean) : [];
  if (type === 'BRANCH') return { type, branchIds: arr(raw?.branchIds) };
  if (type === 'EMPLOYEE') return { type, employeeIds: arr(raw?.employeeIds) };
  return { type: 'ALL' };
}

function normalizePolicy(raw: any): CompanyPolicy | null {
  if (!raw || typeof raw !== 'object' || !raw.policy_id || !raw.title) return null;
  const now = new Date().toISOString();
  return {
    policy_id: String(raw.policy_id),
    code: String(raw.code || '').slice(0, 40),
    title: String(raw.title).slice(0, 200),
    content: String(raw.content || '').slice(0, 8000),
    category: String(raw.category || 'CHUNG').slice(0, 60),
    effective_from: raw.effective_from ? String(raw.effective_from).slice(0, 10) : undefined,
    active: raw.active !== false,
    targets: normalizeTarget(raw.targets),
    created_at: String(raw.created_at || now),
    updated_at: String(raw.updated_at || now),
    created_by: String(raw.created_by || 'SYSTEM'),
    created_by_name: raw.created_by_name ? String(raw.created_by_name) : undefined,
  };
}

export async function listCompanyPolicies(repo: ISheetsRepository): Promise<CompanyPolicy[]> {
  const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
  const raw = (settings as any)[COMPANY_POLICY_KEY];
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map(normalizePolicy)
    .filter((p): p is CompanyPolicy => !!p)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

async function persist(repo: ISheetsRepository, policies: CompanyPolicy[]): Promise<void> {
  await withSettingsLock(async () => {
    const settings = (await repo.getSystemSettings().catch(() => ({}))) || {};
    await repo.updateSystemSettings({ ...(settings as any), [COMPANY_POLICY_KEY]: policies });
  });
}

export async function upsertCompanyPolicy(
  repo: ISheetsRepository,
  input: any,
  actor: { id: string; name?: string },
): Promise<CompanyPolicy> {
  const now = new Date().toISOString();
  const list = await listCompanyPolicies(repo);
  const id = input?.policy_id || `POL_${randomUUID()}`;
  const existing = list.find(p => p.policy_id === id);
  const policy: CompanyPolicy = {
    policy_id: id,
    code: String(input?.code || existing?.code || `QC-${now.slice(0, 10).replace(/-/g, '')}`).slice(0, 40),
    title: String(input?.title || existing?.title || '').trim().slice(0, 200),
    content: String(input?.content ?? existing?.content ?? '').slice(0, 8000),
    category: String(input?.category || existing?.category || 'CHUNG').slice(0, 60),
    effective_from: (input?.effective_from ? String(input.effective_from).slice(0, 10) : existing?.effective_from),
    active: input?.active !== undefined ? input.active !== false : (existing?.active ?? true),
    targets: normalizeTarget(input?.targets ?? existing?.targets),
    created_at: existing?.created_at || now,
    updated_at: now,
    created_by: existing?.created_by || actor.id,
    created_by_name: existing?.created_by_name || actor.name,
  };
  if (!policy.title) throw new Error('MISSING_TITLE');
  const next = existing
    ? list.map(p => (p.policy_id === id ? policy : p))
    : [policy, ...list];
  await persist(repo, next);
  return policy;
}

export async function deleteCompanyPolicy(repo: ISheetsRepository, id: string): Promise<boolean> {
  const list = await listCompanyPolicies(repo);
  const next = list.filter(p => p.policy_id !== id);
  if (next.length === list.length) return false;
  await persist(repo, next);
  return true;
}
