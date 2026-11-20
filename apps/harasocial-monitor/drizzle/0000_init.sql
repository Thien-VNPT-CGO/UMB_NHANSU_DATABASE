-- HaraSocial Zalo Alert — schema khởi tạo PostgreSQL
-- Chạy: npm run db:migrate (hoặc psql -f drizzle/0000_init.sql)

CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_configs (
  owner_uid TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  zalo JSONB NOT NULL,
  zalo_personal_session JSONB NOT NULL DEFAULT '{}'::jsonb,
  channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  hr JSONB NOT NULL,
  harasocial_webhook_secret TEXT NOT NULL DEFAULT '',
  sla_threshold_minutes INTEGER NOT NULL DEFAULT 5,
  repeat_alert_interval_minutes INTEGER NOT NULL DEFAULT 2,
  cloud_worker_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_worker_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_staff (
  owner_uid TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  zalo_tag TEXT NOT NULL DEFAULT '',
  zalo_user_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'sale',
  shift TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  monitor_channel_id TEXT,
  monitor_channel_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_hr_id TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, id)
);
CREATE INDEX IF NOT EXISTS sales_staff_owner_idx ON sales_staff(owner_uid);

CREATE TABLE IF NOT EXISTS harasocial_conversations (
  owner_uid TEXT NOT NULL,
  id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT 'Khách hàng',
  channel TEXT NOT NULL DEFAULT 'Livechat',
  monitor_channel_id TEXT NOT NULL,
  assigned_staff_id TEXT,
  last_message TEXT NOT NULL DEFAULT '',
  last_sender TEXT NOT NULL DEFAULT 'customer',
  last_customer_message_at TIMESTAMPTZ,
  last_staff_reply_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  response_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'waiting',
  alert_sent_for_current_turn BOOLEAN NOT NULL DEFAULT FALSE,
  last_alert_sent_at TIMESTAMPTZ,
  alert_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_uid, id)
);
CREATE INDEX IF NOT EXISTS conversations_owner_channel_idx ON harasocial_conversations(owner_uid, channel_id);
CREATE INDEX IF NOT EXISTS conversations_owner_status_idx ON harasocial_conversations(owner_uid, status);

CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  conversation_id TEXT,
  channel_id TEXT,
  zalo_group_id TEXT NOT NULL DEFAULT '',
  zalo_group_name TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'live_api',
  provider TEXT NOT NULL DEFAULT 'personal',
  success BOOLEAN NOT NULL DEFAULT FALSE,
  detail TEXT NOT NULL DEFAULT '',
  alert_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_logs_owner_idx ON notification_logs(owner_uid, created_at DESC);
