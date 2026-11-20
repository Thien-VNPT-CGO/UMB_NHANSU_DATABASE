import { randomUUID } from 'node:crypto';
import { listStaff, insertStaffRow, updateStaff } from '../db/repo';
import { applyHrUpdates, parseHrPayload } from '../../shared/hr-sync';
import { broadcast } from './events';

export interface HrApplySummary {
  received: number;
  matched: number;
  created: number;
  unmatched: Array<{ name?: string; email?: string; externalHrId?: string }>;
  applied: number;
}

/** Parse + áp lịch HR vào DB, giữ nguyên toàn bộ dữ liệu Zalo/cổng của nhân viên. */
export async function applyHrPayload(ownerUid: string, payload: unknown, autoCreate: boolean): Promise<HrApplySummary> {
  const updates = parseHrPayload(payload);
  if (!updates.length) {
    return { received: 0, matched: 0, created: 0, unmatched: [], applied: 0 };
  }
  const staff = await listStaff(ownerUid);
  const result = applyHrUpdates(staff, updates, {
    ownerUid,
    autoCreateMissingStaff: autoCreate,
    idFactory: () => randomUUID(),
  });

  let applied = 0;
  for (const patch of result.patches) {
    if (Object.keys(patch.patch).length === 0) {
      applied += 1;
      continue;
    }
    const updated = await updateStaff(ownerUid, patch.staffId, {
      shift: patch.patch.shift,
      active: patch.patch.active,
      externalHrId: patch.patch.externalHrId,
      email: patch.patch.email,
      name: patch.patch.name,
    });
    if (updated) applied += 1;
  }
  for (const created of result.created) {
    await insertStaffRow(created);
    applied += 1;
  }

  if (applied > 0) {
    broadcast(ownerUid, 'staff', { source: 'hr', matched: result.matchedCount, created: result.created.length });
  }

  return {
    received: updates.length,
    matched: result.matchedCount,
    created: result.created.length,
    unmatched: result.unmatched.map((u) => ({ name: u.name, email: u.email, externalHrId: u.externalHrId })),
    applied,
  };
}
