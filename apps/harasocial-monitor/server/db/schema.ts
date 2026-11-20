import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  ChannelConfig,
  HrConfig,
  ZaloConfig,
  ZaloGroupRef,
  ZaloPersonalSession,
} from '../../shared/types';

export const users = pgTable('users', {
  uid: text('uid').primaryKey(),
  email: text('email'),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const workspaceConfigs = pgTable('workspace_configs', {
  ownerUid: text('owner_uid').primaryKey().references(() => users.uid, { onDelete: 'cascade' }),
  zalo: jsonb('zalo').$type<ZaloConfig>().notNull(),
  zaloPersonalSession: jsonb('zalo_personal_session').$type<ZaloPersonalSession>().notNull().default(sql`'{}'::jsonb`),
  channels: jsonb('channels').$type<ChannelConfig[]>().notNull().default(sql`'[]'::jsonb`),
  hr: jsonb('hr').$type<HrConfig>().notNull(),
  harasocialWebhookSecret: text('harasocial_webhook_secret').notNull().default(''),
  slaThresholdMinutes: integer('sla_threshold_minutes').notNull().default(5),
  repeatAlertIntervalMinutes: integer('repeat_alert_interval_minutes').notNull().default(2),
  cloudWorkerEnabled: boolean('cloud_worker_enabled').notNull().default(true),
  lastWorkerRunAt: timestamp('last_worker_run_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const salesStaff = pgTable(
  'sales_staff',
  {
    ownerUid: text('owner_uid').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    zaloTag: text('zalo_tag').notNull().default(''),
    zaloUserId: text('zalo_user_id').notNull().default(''),
    role: text('role').notNull().default('sale'),
    shift: text('shift').notNull().default(''),
    active: boolean('active').notNull().default(true),
    monitorChannelId: text('monitor_channel_id'),
    monitorChannelIds: jsonb('monitor_channel_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    externalHrId: text('external_hr_id'),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerUid, table.id] }),
    index('sales_staff_owner_idx').on(table.ownerUid),
  ]
);

export const harasocialConversations = pgTable(
  'harasocial_conversations',
  {
    ownerUid: text('owner_uid').notNull(),
    id: text('id').notNull(),
    channelId: text('channel_id').notNull(),
    customerName: text('customer_name').notNull().default('Khách hàng'),
    channel: text('channel').notNull().default('Livechat'),
    monitorChannelId: text('monitor_channel_id').notNull(),
    assignedStaffId: text('assigned_staff_id'),
    lastMessage: text('last_message').notNull().default(''),
    lastSender: text('last_sender').notNull().default('customer'),
    lastCustomerMessageAt: timestamp('last_customer_message_at', { withTimezone: true, mode: 'string' }),
    lastStaffReplyAt: timestamp('last_staff_reply_at', { withTimezone: true, mode: 'string' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true, mode: 'string' }),
    responseMinutes: integer('response_minutes'),
    status: text('status').notNull().default('waiting'),
    alertSentForCurrentTurn: boolean('alert_sent_for_current_turn').notNull().default(false),
    lastAlertSentAt: timestamp('last_alert_sent_at', { withTimezone: true, mode: 'string' }),
    alertCount: integer('alert_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerUid, table.id] }),
    index('conversations_owner_channel_idx').on(table.ownerUid, table.channelId),
    index('conversations_owner_status_idx').on(table.ownerUid, table.status),
  ]
);

export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: text('id').primaryKey(),
    ownerUid: text('owner_uid').notNull(),
    conversationId: text('conversation_id'),
    channelId: text('channel_id'),
    zaloGroupId: text('zalo_group_id').notNull().default(''),
    zaloGroupName: text('zalo_group_name').notNull().default(''),
    mode: text('mode').notNull().default('live_api'),
    provider: text('provider').notNull().default('personal'),
    success: boolean('success').notNull().default(false),
    detail: text('detail').notNull().default(''),
    alertCount: integer('alert_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [index('notification_logs_owner_idx').on(table.ownerUid, table.createdAt)],
);

export type WorkspaceRow = typeof workspaceConfigs.$inferSelect;
export type StaffRow = typeof salesStaff.$inferSelect;
export type ConversationRow = typeof harasocialConversations.$inferSelect;
export type LogRow = typeof notificationLogs.$inferSelect;
export type ZaloGroupRow = ZaloGroupRef;
