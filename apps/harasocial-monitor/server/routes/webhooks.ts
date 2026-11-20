import { Router } from 'express';
import { getWorkspace, updateChannelSync, upsertIncomingConversation } from '../db/repo';
import { parseHarasocialPayload } from '../../shared/harasocial';
import { applyHrPayload } from '../services/hr-sync-service';
import { markHrSynced } from '../services/pull-service';
import { broadcast } from '../services/events';
import { asyncHandler, safeEqual, secretFrom } from './helpers';
import type { ChannelConfig, WorkspaceConfig } from '../../shared/types';

export const webhookRouter = Router();

webhookRouter.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-hr-secret, x-harasocial-secret, x-webhook-secret, Authorization'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function queryText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function workspaceFromQuery(req: any): Promise<WorkspaceConfig | null> {
  const uid = queryText(req.query.workspace) || queryText(req.query.owner) || queryText(req.query.uid) || queryText(req.body?.workspace);
  if (!uid) return null;
  return getWorkspace(uid);
}

function channelFrom(workspace: WorkspaceConfig, req: any): ChannelConfig | null {
  const channelId = queryText(req.query.channelId) || queryText(req.body?.channelId);
  const channelKey = queryText(req.query.channelKey) || queryText(req.body?.channelKey) || queryText(req.body?.metadata?.channelKey);
  if (channelId) return workspace.channels.find((c) => c.id === channelId) || null;
  if (channelKey) {
    return workspace.channels.find((c) => c.channelKey === channelKey) || workspace.channels.find((c) => c.id === channelKey) || null;
  }
  const active = workspace.channels.filter((c) => c.active !== false);
  return active.length === 1 ? active[0] : null;
}

function checkSecret(req: any, expected: string, headerNames: string[]): boolean {
  if (!expected) return true;
  const provided = secretFrom(req, headerNames);
  return !!provided && safeEqual(provided, expected);
}

/**
 * Webhook HaraSocial / Make.com:
 *   POST /api/webhooks/harasocial?workspace=<uid>&channelKey=<key>
 *   Header: x-harasocial-secret: <workspace.harasocialWebhookSecret>
 */
webhookRouter.all(
  '/harasocial',
  asyncHandler(async (req, res) => {
    const workspace = await workspaceFromQuery(req);
    if (!workspace) {
      res.status(404).json({ ok: false, error: 'Không tìm thấy workspace (query ?workspace=...).' });
      return;
    }
    if (!checkSecret(req, workspace.harasocialWebhookSecret, ['x-harasocial-secret', 'x-webhook-secret'])) {
      res.status(401).json({ ok: false, error: 'Sai hoặc thiếu x-harasocial-secret.' });
      return;
    }

    const challenge = queryText(req.query.challenge) || queryText(req.query['hub.challenge']);
    if (challenge) {
      res.json({ ok: true, challenge });
      return;
    }

    const channel = channelFrom(workspace, req);
    if (!channel) {
      res.status(400).json({
        ok: false,
        error: 'Không xác định được cổng. Truyền ?channelKey=... (xem URL riêng từng cổng trong Cài đặt).',
      });
      return;
    }

    const payload = req.method === 'GET' ? { ...req.query } : req.body;
    const incoming = parseHarasocialPayload(payload, { pageId: channel.harasocialPageId || null });
    if (!incoming.length) {
      res.json({ ok: true, received: 0, ignored: true, channelId: channel.id, note: 'Không đọc được hội thoại trong payload.' });
      return;
    }

    let created = 0;
    let skipped = 0;
    for (const item of incoming) {
      const result = await upsertIncomingConversation(workspace.ownerUid, channel.id, item);
      if (result.created) created += 1;
      if (result.skipped) skipped += 1;
    }

    await updateChannelSync(workspace.ownerUid, channel.id, {
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: `Webhook · nhận ${incoming.length}, mới ${created}`,
    });
    broadcast(workspace.ownerUid, 'conversations', { source: 'harasocial_webhook', channelId: channel.id });
    broadcast(workspace.ownerUid, 'channels', {});

    res.json({ ok: true, received: incoming.length, created, skipped, channelId: channel.id });
  })
);

/**
 * Webhook lịch làm việc từ Web App Quản lý Nhân sự:
 *   GET/POST /api/webhooks/hr?workspace=<uid>
 *   Header: x-hr-secret: <workspace.hr.webhookSecret>
 * CORS mở để SPA/backend app khác gọi trực tiếp.
 */
webhookRouter.all(
  '/hr',
  asyncHandler(async (req, res) => {
    const workspace = await workspaceFromQuery(req);
    if (!workspace) {
      res.status(404).json({ ok: false, error: 'Không tìm thấy workspace (query ?workspace=...).' });
      return;
    }
    if (!checkSecret(req, workspace.hr.webhookSecret || '', ['x-hr-secret', 'x-webhook-secret'])) {
      res.status(401).json({ ok: false, error: 'Sai hoặc thiếu x-hr-secret.' });
      return;
    }

    const payload = req.method === 'GET' ? { ...req.query } : req.body;
    const summary = await applyHrPayload(workspace.ownerUid, payload, workspace.hr.autoCreateMissingStaff === true);
    if (summary.received === 0) {
      res.status(400).json({
        ok: false,
        error: 'Không đọc được nhân viên/ca trong payload. Hỗ trợ 1 nhân viên hoặc mảng employees/shifts/schedules/items.',
        summary,
      });
      return;
    }

    await markHrSynced(workspace.ownerUid, summary);
    res.json({ ok: true, ...summary });
  })
);
