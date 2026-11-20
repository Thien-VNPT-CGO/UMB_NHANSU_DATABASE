import { Router } from 'express';
import { AppError } from '../errors';
import { asyncHandler } from './helpers';
import {
  cancelQrLogin,
  connectWithCookie,
  disconnectPersonal,
  listGroupMembers,
  listGroups,
  personalStatus,
  qrStatus,
  startQrLogin,
} from '../services/zalo-personal';

export const zaloRouter = Router();

zaloRouter.get(
  '/zalo/personal/status',
  asyncHandler(async (req, res) => {
    res.json(await personalStatus(req.ownerUid!));
  })
);

zaloRouter.post(
  '/zalo/personal/qr',
  asyncHandler(async (req, res) => {
    res.json(startQrLogin(req.ownerUid!));
  })
);

zaloRouter.get(
  '/zalo/personal/qr/:loginId',
  asyncHandler(async (req, res) => {
    const status = qrStatus(req.ownerUid!, req.params.loginId);
    if (!status) throw new AppError(404, 'QR_NOT_FOUND', 'Phiên QR không tồn tại hoặc đã kết thúc.');
    res.json(status);
  })
);

zaloRouter.delete(
  '/zalo/personal/qr/:loginId',
  asyncHandler(async (req, res) => {
    res.json({ ok: cancelQrLogin(req.ownerUid!, req.params.loginId) });
  })
);

zaloRouter.post(
  '/zalo/personal/cookie',
  asyncHandler(async (req, res) => {
    const body = (req.body || {}) as { cookie?: unknown; imei?: string; userAgent?: string };
    const account = await connectWithCookie(req.ownerUid!, {
      cookie: body.cookie,
      imei: String(body.imei || ''),
      userAgent: String(body.userAgent || ''),
    });
    res.json({ ok: true, account });
  })
);

zaloRouter.post(
  '/zalo/personal/disconnect',
  asyncHandler(async (req, res) => {
    await disconnectPersonal(req.ownerUid!);
    res.json({ ok: true });
  })
);

zaloRouter.get(
  '/zalo/groups',
  asyncHandler(async (req, res) => {
    const groups = await listGroups(req.ownerUid!);
    res.json({ groups });
  })
);

zaloRouter.get(
  '/zalo/groups/:groupId/members',
  asyncHandler(async (req, res) => {
    const members = await listGroupMembers(req.ownerUid!, req.params.groupId);
    res.json({ members });
  })
);
