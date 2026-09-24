export type NotificationSeverity = 'SUCCESS' | 'ACTION_REQUIRED' | 'URGENT' | 'SYSTEM';
export type NotificationChannel = 'IN_APP' | 'SOCKET' | 'TELEGRAM';
export type DeliveryStatus = 'QUEUED' | 'SENT' | 'FAILED';

export interface NotificationOutboxItem {
  notification_id: string;
  event_id: string;
  recipient_id: string; // employee_id or admin_id or 'ROLE:ADMIN'
  dedupe_key: string;
  type: string; // e.g. 'account.activated', 'schedule.published', etc.
  severity: NotificationSeverity;
  title: string;
  summary: string;
  target_path?: string;
  channel: NotificationChannel;
  delivery_status: DeliveryStatus;
  attempts: number;
  last_error?: string;
  created_at: string;
}

export interface NotificationInboxItem {
  inbox_id: string;
  notification_id: string;
  recipient_id: string;
  title: string;
  summary: string;
  severity: NotificationSeverity;
  target_path?: string;
  created_at: string;
  read_at?: string;
  acknowledged_at?: string;
  dismissed_at?: string;
  version: number;
}
