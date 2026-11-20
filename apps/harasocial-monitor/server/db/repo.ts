import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import { getDb, schema } from './client';
import type {
  ChannelConfig,
  HarasocialConversation,
  HrConfig,
  NotificationLog,
  SalesStaff,
  WorkspaceConfig,
  ZaloConfig,
  ZaloPersonalSession,
} from '../../shared/types';
import type { IncomingConversation } from '../../shared/harasocial';
import { buildConversationId } from '../../shared/harasocial';
import { computeResponseMinutes } from '../../shared/sla';
import type { ConversationRow, LogRow, StaffRow, WorkspaceRow } from './schema';

export function generateSecret(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString('hex')}`;
}

export function defaultWorkspace(ownerUid: string): WorkspaceConfig {
  const zalo: ZaloConfig = {
    mode: 'personal',
    notifyOnMissChat: true,
    tagAllOnDutyInShift: false,
  };
  const channel: ChannelConfig = {
    id: `ch_${randomBytes(6).toString('hex')}`,
    name: 'Cổng HaraSocial chính',
    channelKey: 'cong-chinh',
    zaloGroups: [],
    slaThresholdMinutes: 5,
    notifyOnMissChat: true,
    tagAllOnDutyInShift: false,
    lastSyncAt: null,
    lastSyncStatus: null,
    active: true,
  };
  const hr: HrConfig = {
    enabled: false,
    webhookSecret: generateSecret('hr'),
    autoCreateMissingStaff: false,
    lastSyncAt: null,
    lastSyncStatus: null,
  };
  return {
    ownerUid,
    zalo,
    zaloPersonalSession: {},
    channels: [channel],
    hr,
    harasocialWebhookSecret: generateSecret('hs'),
    slaThresholdMinutes: 5,
    repeatAlertIntervalMinutes: 2,
    cloudWorkerEnabled: true,
    lastWorkerRunAt: null,
  };
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function workspaceFromRow(row: WorkspaceRow): WorkspaceConfig {
  const fallback = defaultWorkspace(row.ownerUid);
  return {
    ownerUid: row.ownerUid,
    zalo: { ...fallback.zalo, ...(row.zalo || {}) },
    zaloPersonalSession: (row.zaloPersonalSession || {}) as ZaloPersonalSession,
    channels: Array.isArray(row.channels) && row.channels.length ? row.channels : fallback.channels,
    hr: { ...fallback.hr, ...(row.hr || {}) },
    harasocialWebhookSecret: row.harasocialWebhookSecret || fallback.harasocialWebhookSecret,
    slaThresholdMinutes: Number(row.slaThresholdMinutes ?? 5),
    repeatAlertIntervalMinutes: Number(row.repeatAlertIntervalMinutes ?? 2),
    cloudWorkerEnabled: Boolean(row.cloudWorkerEnabled),
    lastWorkerRunAt: row.lastWorkerRunAt ?? null,
  };
}

export function staffFromRow(row: StaffRow): SalesStaff {
  const ids = Array.isArray(row.monitorChannelIds) ? row.monitorChannelIds.filter(Boolean) : [];
  return {
    id: row.id,
    ownerUid: row.ownerUid,
    name: row.name,
    zaloTag: row.zaloTag || '',
    zaloUserId: row.zaloUserId || '',
    role: row.role || 'sale',
    shift: row.shift || '',
    active: row.active !== false,
    monitorChannelId: row.monitorChannelId ?? null,
    monitorChannelIds: ids,
    externalHrId: row.externalHrId ?? null,
    email: row.email ?? null,
  };
}

export function conversationFromRow(row: ConversationRow): HarasocialConversation {
  return {
    id: row.id,
    ownerUid: row.ownerUid,
    channelId: row.channelId,
    customerName: row.customerName,
    channel: row.channel,
    monitorChannelId: row.monitorChannelId,
    assignedStaffId: row.assignedStaffId ?? null,
    lastMessage: row.lastMessage || '',
    lastSender: (row.lastSender as 'customer' | 'staff') || 'customer',
    lastCustomerMessageAt: row.lastCustomerMessageAt ?? null,
    lastStaffReplyAt: row.lastStaffReplyAt ?? null,
    responseMinutes: row.responseMinutes ?? null,
    status: (row.status as HarasocialConversation['status']) || 'waiting',
    alertSentForCurrentTurn: Boolean(row.alertSentForCurrentTurn),
    lastAlertSentAt: row.lastAlertSentAt ?? null,
    alertCount: Number(row.alertCount || 0),
  };
}

export function logFromRow(row: LogRow): NotificationLog {
  return {
    id: row.id,
    ownerUid: row.ownerUid,
    conversationId: row.conversationId ?? null,
    channelId: row.channelId ?? null,
    zaloGroupId: row.zaloGroupId,
    zaloGroupName: row.zaloGroupName,
    mode: (row.mode as 'live_api' | 'sandbox_log') || 'live_api',
    provider: row.provider as NotificationLog['provider'],
    success: Boolean(row.success),
    detail: row.detail || '',
    alertCount: Number(row.alertCount || 0),
    createdAt: row.createdAt,
  };
}

/* ------------------------------------------------------------------ users */

export async function ensureUserWorkspace(uid: string, email: string, displayName: string): Promise<WorkspaceConfig> {
  const db = getDb();
  await db
    .insert(schema.users)
    .values({ uid, email, displayName })
    .onConflictDoUpdate({
      target: schema.users.uid,
      set: { email, displayName, updatedAt: new Date().toISOString() },
    });
  const existing = await getWorkspace(uid);
  if (existing) return existing;
  const defaults = defaultWorkspace(uid);
  await db
    .insert(schema.workspaceConfigs)
    .values({
      ownerUid: uid,
      zalo: defaults.zalo,
      zaloPersonalSession: defaults.zaloPersonalSession,
      channels: defaults.channels,
      hr: defaults.hr,
      harasocialWebhookSecret: defaults.harasocialWebhookSecret,
      slaThresholdMinutes: defaults.slaThresholdMinutes,
      repeatAlertIntervalMinutes: defaults.repeatAlertIntervalMinutes,
      cloudWorkerEnabled: defaults.cloudWorkerEnabled,
    })
    .onConflictDoNothing();
  return (await getWorkspace(uid)) || defaults;
}

export async function getWorkspace(ownerUid: string): Promise<WorkspaceConfig | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceConfigs)
    .where(eq(schema.workspaceConfigs.ownerUid, ownerUid))
    .limit(1);
  return rows[0] ? workspaceFromRow(rows[0]) : null;
}

export type WorkspacePatch = Partial<
  Pick<
    WorkspaceConfig,
    | 'zalo'
    | 'zaloPersonalSession'
    | 'channels'
    | 'hr'
    | 'harasocialWebhookSecret'
    | 'slaThresholdMinutes'
    | 'repeatAlertIntervalMinutes'
    | 'cloudWorkerEnabled'
  >
> & { lastWorkerRunAt?: string | null };

export async function updateWorkspace(ownerUid: string, patch: WorkspacePatch): Promise<WorkspaceConfig> {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of [
    'zalo',
    'zaloPersonalSession',
    'channels',
    'hr',
    'harasocialWebhookSecret',
    'slaThresholdMinutes',
    'repeatAlertIntervalMinutes',
    'cloudWorkerEnabled',
    'lastWorkerRunAt',
  ] as const) {
    if ((patch as any)[key] !== undefined) set[key] = (patch as any)[key];
  }
  await db.update(schema.workspaceConfigs).set(set as any).where(eq(schema.workspaceConfigs.ownerUid, ownerUid));
  const next = await getWorkspace(ownerUid);
  if (!next) throw new Error('Không tìm thấy cấu hình workspace.');
  return next;
}

export async function listWorkerWorkspaces(): Promise<WorkspaceConfig[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceConfigs)
    .where(eq(schema.workspaceConfigs.cloudWorkerEnabled, true));
  return rows.map(workspaceFromRow);
}

/* ------------------------------------------------------------------ staff */

export interface StaffInput {
  name: string;
  zaloTag?: string;
  zaloUserId?: string;
  role?: string;
  shift?: string;
  active?: boolean;
  monitorChannelId?: string | null;
  monitorChannelIds?: string[];
  externalHrId?: string | null;
  email?: string | null;
}

export async function listStaff(ownerUid: string): Promise<SalesStaff[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.salesStaff)
    .where(eq(schema.salesStaff.ownerUid, ownerUid))
    .orderBy(schema.salesStaff.createdAt);
  return rows.map(staffFromRow);
}

export async function createStaff(ownerUid: string, input: StaffInput): Promise<SalesStaff> {
  const db = getDb();
  const ids = Array.isArray(input.monitorChannelIds)
    ? [...new Set(input.monitorChannelIds.map((v) => String(v || '').trim()).filter(Boolean))]
    : input.monitorChannelId
      ? [input.monitorChannelId]
      : [];
  const row = {
    ownerUid,
    id: randomUUID(),
    name: String(input.name || '').trim() || 'Nhân viên',
    zaloTag: String(input.zaloTag || '').trim(),
    zaloUserId: String(input.zaloUserId || '').trim(),
    role: String(input.role || 'sale').trim() || 'sale',
    shift: String(input.shift || '').trim(),
    active: input.active !== false,
    monitorChannelId: input.monitorChannelId?.trim() || ids[0] || null,
    monitorChannelIds: ids,
    externalHrId: input.externalHrId?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
  };
  const inserted = await db.insert(schema.salesStaff).values(row).returning();
  return staffFromRow(inserted[0]);
}

export async function updateStaff(ownerUid: string, id: string, patch: Partial<StaffInput>): Promise<SalesStaff | null> {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) set.name = String(patch.name).trim() || 'Nhân viên';
  if (patch.zaloTag !== undefined) set.zaloTag = String(patch.zaloTag).trim();
  if (patch.zaloUserId !== undefined) set.zaloUserId = String(patch.zaloUserId).trim();
  if (patch.role !== undefined) set.role = String(patch.role).trim() || 'sale';
  if (patch.shift !== undefined) set.shift = String(patch.shift).trim();
  if (patch.active !== undefined) set.active = Boolean(patch.active);
  if (patch.externalHrId !== undefined) set.externalHrId = patch.externalHrId ? String(patch.externalHrId).trim() : null;
  if (patch.email !== undefined) set.email = patch.email ? String(patch.email).trim().toLowerCase() : null;
  if (patch.monitorChannelIds !== undefined) {
    const ids = [...new Set((patch.monitorChannelIds || []).map((v) => String(v || '').trim()).filter(Boolean))];
    set.monitorChannelIds = ids;
    set.monitorChannelId = patch.monitorChannelId?.trim() || ids[0] || null;
  } else if (patch.monitorChannelId !== undefined) {
    set.monitorChannelId = patch.monitorChannelId?.trim() || null;
  }
  const updated = await db
    .update(schema.salesStaff)
    .set(set as any)
    .where(and(eq(schema.salesStaff.ownerUid, ownerUid), eq(schema.salesStaff.id, id)))
    .returning();
  return updated[0] ? staffFromRow(updated[0]) : null;
}

export async function deleteStaff(ownerUid: string, id: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(schema.salesStaff)
    .where(and(eq(schema.salesStaff.ownerUid, ownerUid), eq(schema.salesStaff.id, id)))
    .returning();
  return deleted.length > 0;
}

export async function insertStaffRow(staff: SalesStaff): Promise<void> {
  const db = getDb();
  await db.insert(schema.salesStaff).values({
    ownerUid: staff.ownerUid,
    id: staff.id,
    name: staff.name,
    zaloTag: staff.zaloTag,
    zaloUserId: staff.zaloUserId,
    role: staff.role,
    shift: staff.shift,
    active: staff.active,
    monitorChannelId: staff.monitorChannelId,
    monitorChannelIds: staff.monitorChannelIds,
    externalHrId: staff.externalHrId,
    email: staff.email,
  });
}

/* ---------------------------------------------------------- conversations */

export async function listConversations(ownerUid: string): Promise<HarasocialConversation[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.harasocialConversations)
    .where(eq(schema.harasocialConversations.ownerUid, ownerUid))
    .orderBy(desc(schema.harasocialConversations.lastMessageAt));
  return rows.map(conversationFromRow);
}

export async function listDueConversations(ownerUid: string): Promise<HarasocialConversation[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.harasocialConversations)
    .where(
      and(
        eq(schema.harasocialConversations.ownerUid, ownerUid),
        eq(schema.harasocialConversations.lastSender, 'customer'),
        ne(schema.harasocialConversations.status, 'replied')
      )
    )
    .orderBy(schema.harasocialConversations.lastCustomerMessageAt);
  return rows.map(conversationFromRow);
}

export async function getConversation(ownerUid: string, id: string): Promise<HarasocialConversation | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.harasocialConversations)
    .where(
      and(
        eq(schema.harasocialConversations.ownerUid, ownerUid),
        eq(schema.harasocialConversations.id, id)
      )
    )
    .limit(1);
  return rows[0] ? conversationFromRow(rows[0]) : null;
}

export interface UpsertResult {
  conversation: HarasocialConversation;
  created: boolean;
  skipped: boolean;
}

export async function upsertIncomingConversation(
  ownerUid: string,
  channelId: string,
  incoming: IncomingConversation
): Promise<UpsertResult> {
  const db = getDb();
  const id = buildConversationId(channelId, incoming.externalId);
  const nowIso = new Date().toISOString();
  const atIso = incoming.at.toISOString();
  const existing = await getConversation(ownerUid, id);

  if (!existing) {
    const inserted = await db
      .insert(schema.harasocialConversations)
      .values({
        ownerUid,
        id,
        channelId,
        customerName: incoming.customerName,
        channel: incoming.channel,
        monitorChannelId: channelId,
        assignedStaffId: incoming.assignedStaffId,
        lastMessage: incoming.lastMessage,
        lastSender: incoming.lastSender,
        lastCustomerMessageAt: incoming.lastSender === 'customer' ? atIso : null,
        lastStaffReplyAt: incoming.lastSender === 'staff' ? atIso : null,
        lastMessageAt: atIso,
        responseMinutes: null,
        status: incoming.lastSender === 'staff' ? 'replied' : 'waiting',
        alertSentForCurrentTurn: false,
        alertCount: 0,
      })
      .returning();
    return { conversation: conversationFromRow(inserted[0]), created: true, skipped: false };
  }

  if (existing.status === 'replied' && existing.lastSender === 'staff' && incoming.lastSender === 'staff') {
    // Tin staff cập nhật liên tiếp — vẫn ghi nhận thời điểm trả lời mới nhất.
  }

  const existingLastMs = existing.lastCustomerMessageAt || existing.lastStaffReplyAt
    ? Date.parse(existing.lastStaffReplyAt || existing.lastCustomerMessageAt || '')
    : NaN;
  if (Number.isFinite(existingLastMs) && incoming.at.getTime() < existingLastMs - 2000) {
    return { conversation: existing, created: false, skipped: true };
  }

  if (incoming.lastSender === 'staff') {
    const customerAt = existing.lastSender === 'customer' ? existing.lastCustomerMessageAt : null;
    const responseMinutes = computeResponseMinutes(customerAt, atIso);
    const updated = await db
      .update(schema.harasocialConversations)
      .set({
        customerName: incoming.customerName || existing.customerName,
        channel: incoming.channel || existing.channel,
        assignedStaffId: incoming.assignedStaffId || existing.assignedStaffId,
        lastMessage: incoming.lastMessage || existing.lastMessage,
        lastSender: 'staff',
        lastStaffReplyAt: atIso,
        lastMessageAt: atIso,
        responseMinutes: responseMinutes ?? existing.responseMinutes,
        status: 'replied',
        alertSentForCurrentTurn: false,
        lastAlertSentAt: null,
        alertCount: 0,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(schema.harasocialConversations.ownerUid, ownerUid),
          eq(schema.harasocialConversations.id, id)
        )
      )
      .returning();
    return { conversation: conversationFromRow(updated[0]), created: false, skipped: false };
  }

  const newTurn = existing.lastSender === 'staff' || existing.status === 'replied';
  const customerAt = newTurn || !existing.lastCustomerMessageAt ? atIso : existing.lastCustomerMessageAt;
  const status = newTurn ? 'waiting' : existing.status === 'missed' ? 'missed' : 'waiting';
  const updated = await db
    .update(schema.harasocialConversations)
    .set({
      customerName: incoming.customerName || existing.customerName,
      channel: incoming.channel || existing.channel,
      assignedStaffId: incoming.assignedStaffId || existing.assignedStaffId,
      lastMessage: incoming.lastMessage || existing.lastMessage,
      lastSender: 'customer',
      lastCustomerMessageAt: customerAt,
      lastMessageAt: atIso,
      responseMinutes: newTurn ? null : existing.responseMinutes,
      status,
      alertSentForCurrentTurn: newTurn ? false : existing.alertSentForCurrentTurn,
      lastAlertSentAt: newTurn ? null : existing.lastAlertSentAt,
      alertCount: newTurn ? 0 : existing.alertCount,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.harasocialConversations.ownerUid, ownerUid),
        eq(schema.harasocialConversations.id, id)
      )
    )
    .returning();
  return { conversation: conversationFromRow(updated[0]), created: false, skipped: false };
}

export async function markConversationReplied(ownerUid: string, id: string, at: Date = new Date()): Promise<HarasocialConversation | null> {
  const existing = await getConversation(ownerUid, id);
  if (!existing) return null;
  const db = getDb();
  const atIso = at.toISOString();
  const updated = await db
    .update(schema.harasocialConversations)
    .set({
      lastSender: 'staff',
      status: 'replied',
      lastStaffReplyAt: atIso,
      lastMessageAt: atIso,
      responseMinutes: computeResponseMinutes(existing.lastCustomerMessageAt, atIso) ?? existing.responseMinutes,
      alertSentForCurrentTurn: false,
      lastAlertSentAt: null,
      alertCount: 0,
      updatedAt: atIso,
    })
    .where(
      and(
        eq(schema.harasocialConversations.ownerUid, ownerUid),
        eq(schema.harasocialConversations.id, id)
      )
    )
    .returning();
  return updated[0] ? conversationFromRow(updated[0]) : null;
}

export async function markConversationAlerted(
  ownerUid: string,
  id: string,
  alertCount: number,
  at: Date = new Date()
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.harasocialConversations)
    .set({
      status: 'missed',
      alertSentForCurrentTurn: true,
      lastAlertSentAt: at.toISOString(),
      alertCount,
      updatedAt: at.toISOString(),
    })
    .where(
      and(
        eq(schema.harasocialConversations.ownerUid, ownerUid),
        eq(schema.harasocialConversations.id, id)
      )
    );
}

export async function updateConversationStatus(
  ownerUid: string,
  id: string,
  status: 'replied' | 'waiting' | 'missed'
): Promise<HarasocialConversation | null> {
  const db = getDb();
  const set: Record<string, unknown> = { status, updatedAt: new Date().toISOString() };
  if (status === 'replied') {
    set.alertSentForCurrentTurn = false;
    set.alertCount = 0;
  }
  const updated = await db
    .update(schema.harasocialConversations)
    .set(set as any)
    .where(
      and(
        eq(schema.harasocialConversations.ownerUid, ownerUid),
        eq(schema.harasocialConversations.id, id)
      )
    )
    .returning();
  return updated[0] ? conversationFromRow(updated[0]) : null;
}

export async function clearConversationsAndLogs(ownerUid: string): Promise<{ conversations: number; logs: number }> {
  const db = getDb();
  const conv = await db
    .delete(schema.harasocialConversations)
    .where(eq(schema.harasocialConversations.ownerUid, ownerUid))
    .returning({ id: schema.harasocialConversations.id });
  const logs = await db
    .delete(schema.notificationLogs)
    .where(eq(schema.notificationLogs.ownerUid, ownerUid))
    .returning({ id: schema.notificationLogs.id });
  return { conversations: conv.length, logs: logs.length };
}

/* ------------------------------------------------------------------- logs */

export interface LogInput {
  conversationId?: string | null;
  channelId?: string | null;
  zaloGroupId: string;
  zaloGroupName: string;
  mode: 'live_api' | 'sandbox_log';
  provider: NotificationLog['provider'];
  success: boolean;
  detail: string;
  alertCount: number;
}

export async function insertNotificationLog(ownerUid: string, input: LogInput): Promise<NotificationLog> {
  const db = getDb();
  const row = {
    id: randomUUID(),
    ownerUid,
    conversationId: input.conversationId ?? null,
    channelId: input.channelId ?? null,
    zaloGroupId: input.zaloGroupId || '',
    zaloGroupName: input.zaloGroupName || '',
    mode: input.mode,
    provider: input.provider,
    success: input.success,
    detail: String(input.detail || '').slice(0, 4000),
    alertCount: input.alertCount,
  };
  const inserted = await db.insert(schema.notificationLogs).values(row).returning();
  return logFromRow(inserted[0]);
}

export async function listNotificationLogs(ownerUid: string, limit = 200): Promise<NotificationLog[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.notificationLogs)
    .where(eq(schema.notificationLogs.ownerUid, ownerUid))
    .orderBy(desc(schema.notificationLogs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map(logFromRow);
}

/* --------------------------------------------------------------- channels */

export function channelGroups(channel: ChannelConfig): Array<{ id: string; name: string }> {
  const list = Array.isArray(channel.zaloGroups) ? channel.zaloGroups : [];
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string }> = [];
  for (const g of list) {
    const id = String(g?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(g?.name || id) });
  }
  if (channel.zaloGroupId && !seen.has(channel.zaloGroupId)) {
    out.push({ id: channel.zaloGroupId, name: channel.zaloGroupName || channel.zaloGroupId });
  }
  return out;
}

export async function updateChannelSync(
  ownerUid: string,
  channelId: string,
  status: { lastSyncAt?: string | null; lastSyncStatus?: string | null }
): Promise<void> {
  const workspace = await getWorkspace(ownerUid);
  if (!workspace) return;
  const channels = workspace.channels.map((c) => (c.id === channelId ? { ...c, ...status } : c));
  await updateWorkspace(ownerUid, { channels });
}

export { iso };
