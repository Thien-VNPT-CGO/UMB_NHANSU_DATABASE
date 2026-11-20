import { Router } from 'express';
import { AppError } from '../errors';
import {
  channelGroups,
  clearConversationsAndLogs,
  createStaff,
  deleteStaff,
  ensureUserWorkspace,
  getConversation,
  getWorkspace,
  insertNotificationLog,
  listConversations,
  listNotificationLogs,
  listStaff,
  updateConversationStatus,
  updateStaff,
  updateWorkspace,
  type WorkspacePatch,
} from '../db/repo';
import { asyncHandler, requestBase, sanitizeChannels, sanitizeHr, sanitizeZalo, generateWebhookSecret } from './helpers';
import { broadcast, addSseClient } from '../services/events';
import { pullHarasocialForOwner, pullHrForOwner } from '../services/pull-service';
import { markReplied, runSlaForOwner } from '../services/sla-service';
import { sendTestGroup } from '../services/zalo-sender';
import type { HarasocialConversation, SalesStaff } from '../../shared/types';

export const apiRouter = Router();

apiRouter.get(
  '/bootstrap',
  asyncHandler(async (req, res) => {
    const ownerUid = req.ownerUid!;
    const workspace = await ensureUserWorkspace(ownerUid, req.ownerEmail || '', req.ownerName || '');
    const [staff, conversations, logs] = await Promise.all([
      listStaff(ownerUid),
      listConversations(ownerUid),
      listNotificationLogs(ownerUid, 200),
    ]);
    const base = requestBase(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      user: { uid: ownerUid, email: req.ownerEmail || '', displayName: req.ownerName || '' },
      workspace,
      staff,
      conversations,
      logs,
      serverNow: new Date().toISOString(),
      baseUrl: base,
      links: {
        harasocialWebhook: `${base}/api/webhooks/harasocial`,
        hrWebhook: `${base}/api/webhooks/hr`,
      },
      worker: { enabled: workspace.cloudWorkerEnabled, lastRunAt: workspace.lastWorkerRunAt, intervalSeconds: 30 },
    });
  })
);

apiRouter.patch(
  '/workspace',
  asyncHandler(async (req, res) => {
    const ownerUid = req.ownerUid!;
    const workspace = await getWorkspace(ownerUid);
    if (!workspace) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Không tìm thấy cấu hình tài khoản.');
    const body = (req.body || {}) as Record<string, unknown>;
    const patch: WorkspacePatch = {};

    if (body.zalo !== undefined) patch.zalo = sanitizeZalo(body.zalo, workspace.zalo);
    if (body.channels !== undefined) patch.channels = sanitizeChannels(body.channels, workspace.channels);
    if (body.hr !== undefined) patch.hr = sanitizeHr(body.hr, workspace.hr);
    if (body.harasocialWebhookSecret !== undefined) {
      patch.harasocialWebhookSecret = String(body.harasocialWebhookSecret || '').trim().slice(0, 200);
    }
    if (body.slaThresholdMinutes !== undefined) {
      const n = Number(body.slaThresholdMinutes);
      if (!Number.isFinite(n) || n < 0 || n > 10080) throw new AppError(400, 'INVALID_SLA', 'Ngưỡng SLA phải từ 0 đến 10080 phút.');
      patch.slaThresholdMinutes = Math.round(n);
    }
    if (body.repeatAlertIntervalMinutes !== undefined) {
      const n = Number(body.repeatAlertIntervalMinutes);
      if (!Number.isFinite(n) || n < 0 || n > 1440) {
        throw new AppError(400, 'INVALID_REPEAT', 'Chu kỳ nhắc lại phải từ 0 đến 1440 phút (0 = tắt).');
      }
      patch.repeatAlertIntervalMinutes = Math.round(n);
    }
    if (body.cloudWorkerEnabled !== undefined) patch.cloudWorkerEnabled = body.cloudWorkerEnabled === true;

    const updated = await updateWorkspace(ownerUid, patch);
    broadcast(ownerUid, 'workspace', { at: new Date().toISOString() });
    if (patch.channels) broadcast(ownerUid, 'channels', {});
    res.json({ workspace: updated });
  })
);

apiRouter.post(
  '/workspace/secret',
  asyncHandler(async (req, res) => {
    const ownerUid = req.ownerUid!;
    const workspace = await getWorkspace(ownerUid);
    if (!workspace) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Không tìm thấy cấu hình tài khoản.');
    const field = String((req.body || {}).field || 'harasocial');
    if (field === 'hr') {
      const secret = generateWebhookSecret('hr');
      await updateWorkspace(ownerUid, { hr: { ...workspace.hr, webhookSecret: secret } });
      broadcast(ownerUid, 'workspace', {});
      res.json({ field, secret });
      return;
    }
    const secret = generateWebhookSecret('hs');
    await updateWorkspace(ownerUid, { harasocialWebhookSecret: secret });
    broadcast(ownerUid, 'workspace', {});
    res.json({ field: 'harasocial', secret });
  })
);

/* ------------------------------------------------------------------ staff */

apiRouter.get(
  '/staff',
  asyncHandler(async (req, res) => {
    res.json({ staff: await listStaff(req.ownerUid!) });
  })
);

apiRouter.post(
  '/staff',
  asyncHandler(async (req, res) => {
    const body = (req.body || {}) as Partial<SalesStaff>;
    if (!String(body.name || '').trim()) throw new AppError(400, 'NAME_REQUIRED', 'Vui lòng nhập tên nhân viên.');
    const staff = await createStaff(req.ownerUid!, {
      name: String(body.name),
      zaloTag: body.zaloTag,
      zaloUserId: body.zaloUserId,
      role: body.role,
      shift: body.shift,
      active: body.active,
      monitorChannelIds: body.monitorChannelIds,
      monitorChannelId: body.monitorChannelId,
      externalHrId: body.externalHrId,
      email: body.email,
    });
    broadcast(req.ownerUid!, 'staff', { created: staff.id });
    res.status(201).json({ staff });
  })
);

apiRouter.patch(
  '/staff/:id',
  asyncHandler(async (req, res) => {
    const body = (req.body || {}) as Partial<SalesStaff>;
    const staff = await updateStaff(req.ownerUid!, req.params.id, body);
    if (!staff) throw new AppError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy nhân viên.');
    broadcast(req.ownerUid!, 'staff', { updated: staff.id });
    res.json({ staff });
  })
);

apiRouter.delete(
  '/staff/:id',
  asyncHandler(async (req, res) => {
    const removed = await deleteStaff(req.ownerUid!, req.params.id);
    if (!removed) throw new AppError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy nhân viên.');
    broadcast(req.ownerUid!, 'staff', { deleted: req.params.id });
    res.json({ ok: true });
  })
);

/* ---------------------------------------------------------- conversations */

apiRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    res.json({ conversations: await listConversations(req.ownerUid!) });
  })
);

apiRouter.post(
  '/conversations/reply',
  asyncHandler(async (req, res) => {
    const id = String((req.body || {}).id || '').trim();
    if (!id) throw new AppError(400, 'ID_REQUIRED', 'Thiếu ID hội thoại.');
    const conversation = await markReplied(req.ownerUid!, id);
    res.json({ conversation });
  })
);

apiRouter.post(
  '/conversations/alert',
  asyncHandler(async (req, res) => {
    const id = String((req.body || {}).id || '').trim();
    if (!id) throw new AppError(400, 'ID_REQUIRED', 'Thiếu ID hội thoại.');
    const conversation = await getConversation(req.ownerUid!, id);
    if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Không tìm thấy hội thoại.');
    if (conversation.status === 'replied' && conversation.lastSender === 'staff') {
      throw new AppError(400, 'ALREADY_REPLIED', 'Hội thoại đã được nhân viên trả lời — không cần nhắc Zalo.');
    }
    const result = await runSlaForOwner(req.ownerUid!, { force: true, conversationId: id });
    const detail = result.details[0];
    if (!detail) throw new AppError(400, 'ALERT_NOT_SENT', 'Không gửi được cảnh báo (kiểm tra cổng, nhóm Zalo và kết nối Zalo).');
    res.json({ ok: detail.success, detail, result });
  })
);

apiRouter.post(
  '/conversations/status',
  asyncHandler(async (req, res) => {
    const body = (req.body || {}) as { id?: string; status?: string };
    const id = String(body.id || '').trim();
    const status = String(body.status || '') as HarasocialConversation['status'];
    if (!id || !['replied', 'waiting', 'missed'].includes(status)) {
      throw new AppError(400, 'INVALID_STATUS', 'Trạng thái không hợp lệ.');
    }
    const conversation = await updateConversationStatus(req.ownerUid!, id, status);
    if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Không tìm thấy hội thoại.');
    broadcast(req.ownerUid!, 'conversations', { conversationId: id });
    res.json({ conversation });
  })
);

apiRouter.post(
  '/conversations/clear',
  asyncHandler(async (req, res) => {
    const removed = await clearConversationsAndLogs(req.ownerUid!);
    broadcast(req.ownerUid!, 'conversations', { cleared: true });
    broadcast(req.ownerUid!, 'logs', { cleared: true });
    res.json({ ok: true, ...removed });
  })
);

/* --------------------------------------------------------------- actions */

apiRouter.post(
  '/sync/harasocial',
  asyncHandler(async (req, res) => {
    const result = await pullHarasocialForOwner(req.ownerUid!);
    res.json(result);
  })
);

apiRouter.post(
  '/sla/run',
  asyncHandler(async (req, res) => {
    const result = await runSlaForOwner(req.ownerUid!, { now: new Date() });
    res.json(result);
  })
);

apiRouter.post(
  '/hr/pull',
  asyncHandler(async (req, res) => {
    const result = await pullHrForOwner(req.ownerUid!);
    if (!result.ok) throw new AppError(400, 'HR_PULL_FAILED', result.error || 'Đồng bộ HR thất bại.');
    res.json(result);
  })
);

apiRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit || 200);
    res.json({ logs: await listNotificationLogs(req.ownerUid!, Number.isFinite(limit) ? limit : 200) });
  })
);

apiRouter.post(
  '/channels/test',
  asyncHandler(async (req, res) => {
    const body = (req.body || {}) as { channelId?: string; groupId?: string };
    const workspace = await getWorkspace(req.ownerUid!);
    if (!workspace) throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Không tìm thấy cấu hình tài khoản.');
    const channel = workspace.channels.find((c) => c.id === body.channelId);
    if (!channel) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Không tìm thấy cổng HaraSocial.');
    const groups = channelGroups(channel);
    const group = body.groupId ? groups.find((g) => g.id === body.groupId) : groups[0];
    if (!group) throw new AppError(400, 'GROUP_REQUIRED', 'Cổng chưa gắn nhóm Zalo nào để test.');

    const result = await sendTestGroup(req.ownerUid!, workspace, channel, group);
    await insertNotificationLog(req.ownerUid!, {
      conversationId: null,
      channelId: channel.id,
      zaloGroupId: group.id,
      zaloGroupName: group.name,
      mode: result.mode,
      provider: result.provider,
      success: result.success,
      detail: `Test gửi nhóm: ${result.detail}`,
      alertCount: 0,
    });
    broadcast(req.ownerUid!, 'logs', {});
    res.json(result);
  })
);

/* ------------------------------------------------------------------- SSE */

apiRouter.get('/stream', (req, res) => {
  const ownerUid = req.ownerUid!;
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  const remove = addSseClient(ownerUid, res);
  req.on('close', remove);
  req.on('aborted', remove);
});
