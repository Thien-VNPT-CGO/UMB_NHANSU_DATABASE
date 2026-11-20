import { AppError } from '../errors';
import {
  channelGroups,
  getConversation,
  getWorkspace,
  insertNotificationLog,
  listDueConversations,
  listStaff,
  markConversationAlerted,
  markConversationReplied,
} from '../db/repo';
import type { ChannelConfig, HarasocialConversation, SalesStaff, WorkspaceConfig } from '../../shared/types';
import { buildZaloMentionMessage } from '../../shared/alert-text';
import { buildAlertText } from '../../shared/alert-text';
import { evaluateSla } from '../../shared/sla';
import { selectDutyStaff } from '../../shared/staff';
import { deliverAlert } from './zalo-sender';
import { broadcast } from './events';

export interface SlaRunResult {
  scanned: number;
  due: number;
  alerted: number;
  failures: number;
  skipped: number;
  details: Array<{
    conversationId: string;
    customerName: string;
    channelId: string;
    alertCount: number;
    targets: string[];
    groups: number;
    success: boolean;
    errors: string[];
  }>;
}

function thresholdFor(workspace: WorkspaceConfig, channel: ChannelConfig): number {
  const value = Number(channel.slaThresholdMinutes ?? workspace.slaThresholdMinutes ?? 5);
  if (!Number.isFinite(value) || value < 0) return 5;
  return Math.min(value, 10_080);
}

function waitingMinutes(conversation: HarasocialConversation, now: Date): number {
  if (!conversation.lastCustomerMessageAt) return 0;
  const ms = now.getTime() - new Date(conversation.lastCustomerMessageAt).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 60_000));
}

function alertsAllowed(workspace: WorkspaceConfig, channel: ChannelConfig): boolean {
  return channel.notifyOnMissChat !== false && workspace.zalo.notifyOnMissChat !== false;
}

async function alertConversation(
  workspace: WorkspaceConfig,
  staff: SalesStaff[],
  conversation: HarasocialConversation,
  channel: ChannelConfig,
  reminderCount: number,
  alertCount: number,
  waited: number,
  now: Date
) {
  const threshold = thresholdFor(workspace, channel);
  const selection = selectDutyStaff(staff, channel.id, now, {
    assignedStaffId: conversation.assignedStaffId,
    tagAllOnDutyInShift: channel.tagAllOnDutyInShift ?? workspace.zalo.tagAllOnDutyInShift ?? false,
  });

  const message = buildZaloMentionMessage({
    channelName: channel.name,
    customerName: conversation.customerName,
    lastMessage: conversation.lastMessage,
    waitedMinutes: waited,
    thresholdMinutes: threshold,
    reminderCount,
    staff: selection.targets,
  });
  const alert = buildAlertText({
    channelName: channel.name,
    customerName: conversation.customerName,
    lastMessage: conversation.lastMessage,
    waitedMinutes: waited,
    thresholdMinutes: threshold,
    reminderCount,
  });

  const deliveries = await deliverAlert({
    ownerUid: workspace.ownerUid,
    workspace,
    channel,
    message,
    title: alert.title,
    body: alert.body,
  });

  for (const delivery of deliveries) {
    await insertNotificationLog(workspace.ownerUid, {
      conversationId: conversation.id,
      channelId: channel.id,
      zaloGroupId: delivery.groupId,
      zaloGroupName: delivery.groupName,
      mode: delivery.mode,
      provider: delivery.provider,
      success: delivery.success,
      detail: delivery.detail,
      alertCount,
    }).catch((e) => console.warn('[sla] cannot write log:', (e as Error).message));
  }

  await markConversationAlerted(workspace.ownerUid, conversation.id, alertCount, now);

  return { selection, deliveries };
}

/** Chạy 1 vòng quét SLA cho 1 tài khoản (worker 30s gọi hàm này). */
export async function runSlaForOwner(
  ownerUid: string,
  options: { now?: Date; force?: boolean; conversationId?: string } = {},
  workspaceInput?: WorkspaceConfig,
  staffInput?: SalesStaff[]
): Promise<SlaRunResult> {
  const now = options.now || new Date();
  const workspace = workspaceInput || (await getWorkspace(ownerUid));
  if (!workspace) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Không tìm thấy cấu hình tài khoản.');
  const staff = staffInput || (await listStaff(ownerUid));
  const channels = new Map(workspace.channels.map((c) => [c.id, c]));

  let conversations = await listDueConversations(ownerUid);
  if (options.conversationId) {
    const single = await getConversation(ownerUid, options.conversationId);
    conversations = single ? [single] : [];
  }

  const result: SlaRunResult = { scanned: conversations.length, due: 0, alerted: 0, failures: 0, skipped: 0, details: [] };

  for (const conversation of conversations) {
    const channel = channels.get(conversation.channelId) || workspace.channels.find((c) => c.id === conversation.monitorChannelId);
    if (!channel) {
      result.skipped += 1;
      continue;
    }
    if (conversation.lastSender !== 'customer' || conversation.status === 'replied') {
      result.skipped += 1;
      continue;
    }
    if (!options.force && !alertsAllowed(workspace, channel)) {
      result.skipped += 1;
      continue;
    }

    const threshold = thresholdFor(workspace, channel);
    const waited = waitingMinutes(conversation, now);
    const decision = options.force
      ? {
          action: conversation.alertSentForCurrentTurn ? ('repeat' as const) : ('first' as const),
          alertCount: conversation.alertSentForCurrentTurn ? Math.max(1, conversation.alertCount) + 1 : 1,
          waitedMinutes: waited,
          nextRepeatAtMinutes: null,
        }
      : evaluateSla(
          {
            lastSender: conversation.lastSender,
            status: conversation.status,
            alertSentForCurrentTurn: conversation.alertSentForCurrentTurn,
            alertCount: conversation.alertCount,
            lastCustomerMessageAt: conversation.lastCustomerMessageAt,
            lastAlertSentAt: conversation.lastAlertSentAt,
          },
          { thresholdMinutes: threshold, repeatIntervalMinutes: workspace.repeatAlertIntervalMinutes },
          now
        );

    if (decision.action === 'none') continue;
    result.due += 1;

    const reminderCount = decision.action === 'first' ? 0 : decision.alertCount;
    try {
      const { selection, deliveries } = await alertConversation(
        workspace,
        staff,
        conversation,
        channel,
        reminderCount,
        decision.alertCount,
        decision.waitedMinutes ?? waited,
        now
      );
      const success = deliveries.some((d) => d.success);
      if (!success) result.failures += 1;
      else result.alerted += 1;
      result.details.push({
        conversationId: conversation.id,
        customerName: conversation.customerName,
        channelId: channel.id,
        alertCount: decision.alertCount,
        targets: selection.targets.map((s) => s.name),
        groups: channelGroups(channel).length,
        success,
        errors: deliveries.filter((d) => !d.success).map((d) => d.detail),
      });
    } catch (e) {
      result.failures += 1;
      result.details.push({
        conversationId: conversation.id,
        customerName: conversation.customerName,
        channelId: channel.id,
        alertCount: decision.alertCount,
        targets: [],
        groups: channelGroups(channel).length,
        success: false,
        errors: [(e as Error).message],
      });
    }
  }

  if (result.due > 0) {
    broadcast(ownerUid, 'sla', { at: now.toISOString(), ...result });
    broadcast(ownerUid, 'conversations', {});
  }
  return result;
}

/** "Đánh dấu đã trả lời" — reset alertCount và chu kỳ cảnh báo. */
export async function markReplied(ownerUid: string, conversationId: string) {
  const updated = await markConversationReplied(ownerUid, conversationId);
  if (!updated) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Không tìm thấy hội thoại.');
  broadcast(ownerUid, 'conversations', { conversationId });
  return updated;
}
