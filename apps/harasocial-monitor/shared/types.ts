/**
 * Kiểu dữ liệu dùng chung cho HaraSocial Zalo Alert.
 * Các module logic thuần chỉ phụ thuộc vào file này (không import DB/Firebase).
 */

export type AlertSendMode = 'personal' | 'webhook' | 'oa_group' | 'oa_user';

export type ConversationStatus = 'replied' | 'waiting' | 'missed';

export type MessageSender = 'customer' | 'staff';

export type HarasocialChannel = 'Facebook' | 'Zalo OA' | 'Instagram' | 'Livechat' | string;

export interface ZaloGroupRef {
  id: string;
  name: string;
}

export interface ZaloConfig {
  /** Phương thức gửi cảnh báo mặc định. */
  mode: AlertSendMode;
  /** Token OA (dùng cho oa_group / oa_user). */
  oaToken?: string;
  /** Webhook trung gian Make/n8n (dùng cho mode webhook). */
  webhookUrl?: string;
  defaultGroupId?: string;
  defaultGroupName?: string;
  notifyOnMissChat?: boolean;
  tagAllOnDutyInShift?: boolean;
}

export interface ZaloPersonalSession {
  cookie?: unknown;
  imei?: string;
  userAgent?: string;
  uid?: string;
  displayName?: string;
  avatar?: string;
  savedAt?: string;
}

export interface ChannelConfig {
  id: string;
  name: string;
  channelKey: string;
  zaloGroups: ZaloGroupRef[];
  zaloGroupId?: string;
  zaloGroupName?: string;
  zaloWebhookUrl?: string;
  harasocialApiUrl?: string;
  harasocialAccessToken?: string;
  harasocialPageId?: string;
  slaThresholdMinutes?: number;
  notifyOnMissChat?: boolean;
  tagAllOnDutyInShift?: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  active: boolean;
}

export interface HrConfig {
  enabled: boolean;
  webhookSecret?: string;
  apiUrl?: string;
  apiToken?: string;
  autoCreateMissingStaff?: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
}

export interface WorkspaceConfig {
  ownerUid: string;
  zalo: ZaloConfig;
  zaloPersonalSession: ZaloPersonalSession;
  channels: ChannelConfig[];
  hr: HrConfig;
  harasocialWebhookSecret: string;
  slaThresholdMinutes: number;
  repeatAlertIntervalMinutes: number;
  cloudWorkerEnabled: boolean;
  lastWorkerRunAt: string | null;
}

export interface SalesStaff {
  id: string;
  ownerUid: string;
  name: string;
  zaloTag: string;
  zaloUserId: string;
  role: string;
  /** Chuỗi ca trực, ví dụ "08:00 - 17:30" hoặc "22:00 - 06:00". */
  shift: string;
  active: boolean;
  /** Tương thích ngược — cổng chính. */
  monitorChannelId: string | null;
  /** Mảng rỗng = phụ trách tất cả các cổng. */
  monitorChannelIds: string[];
  externalHrId: string | null;
  email: string | null;
}

export interface HarasocialConversation {
  id: string;
  ownerUid: string;
  channelId: string;
  customerName: string;
  channel: HarasocialChannel;
  monitorChannelId: string;
  assignedStaffId: string | null;
  lastMessage: string;
  lastSender: MessageSender;
  lastCustomerMessageAt: string | null;
  lastStaffReplyAt: string | null;
  responseMinutes: number | null;
  status: ConversationStatus;
  alertSentForCurrentTurn: boolean;
  lastAlertSentAt: string | null;
  alertCount: number;
}

export interface NotificationLog {
  id: string;
  ownerUid: string;
  conversationId: string | null;
  channelId: string | null;
  zaloGroupId: string;
  zaloGroupName: string;
  mode: 'live_api' | 'sandbox_log';
  provider: AlertSendMode;
  success: boolean;
  detail: string;
  alertCount: number;
  createdAt: string;
}

export interface SlaConfig {
  thresholdMinutes: number;
  repeatIntervalMinutes: number;
}

export interface DutySelection {
  mode: 'assigned' | 'redirect' | 'all' | 'none';
  assigned: SalesStaff | null;
  targets: SalesStaff[];
  onDuty: SalesStaff[];
}

export interface AlertText {
  title: string;
  body: string;
  text: string;
}

export interface ZaloMention {
  pos: number;
  len: number;
  uid: string;
}

export interface ZaloMentionMessage {
  text: string;
  mentions: ZaloMention[];
  /** Danh sách nhân viên thực sự được tag (đã lọc UID hợp lệ). */
  tagged: SalesStaff[];
  /** Nhân viên có tên trong tin nhưng UID không hợp lệ (không tạo mention). */
  skipped: SalesStaff[];
}

export type SlaAction = 'none' | 'first' | 'repeat';

export interface SlaDecision {
  action: SlaAction;
  alertCount: number;
  waitedMinutes: number;
  nextRepeatAtMinutes: number | null;
}
