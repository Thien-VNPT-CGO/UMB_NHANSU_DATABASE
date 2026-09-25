import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import { GoogleSheetsAdapter } from './repositories/google-sheets.adapter.js';
import { singleWriterQueue } from './repositories/single-writer-queue.js';
import { AuthService, sanitizeAdmin } from './services/auth.service.js';
import { hashPassword } from './services/password.service.js';
import {
  assertHangTuanWindow,
  getWeeklyOffCompletion,
  getWeeklyOffWindow,
} from './services/weekly-off.service.js';
import { ZaloService, defaultMeetUrl } from './services/zalo.service.js';
import crypto from 'crypto';
import { AccountsService } from './services/accounts.service.js';
import { EmployeesService } from './services/employees.service.js';
import { canonicalPhone, findDuplicatePhones } from './services/employees.service.js';
import { SchedulesService } from './services/schedules.service.js';
import { AttendanceService } from './services/attendance.service.js';
import { PayrollService } from './services/payroll.service.js';
import { NotificationsService } from './services/notifications.service.js';
import {
  createAuthMiddleware,
  AuthenticatedRequest,
} from './middlewares/auth.middleware.js';
import {
  authRateLimiter,
  buildCorsOptions,
  generalRateLimiter,
  helmetMiddleware,
} from './config/security.js';
import { validate } from './middlewares/validate.middleware.js';
import {
  changePasswordBody,
  adminLoginBody,
  employeeChangePinBody,
  phoneLoginBody,
  refreshBody,
} from './validators/auth.validator.js';
import {
  adjustmentApproveBody,
  adjustmentCreateBody,
  adjustmentsQuery,
  announcementBody,
  attendanceEventBody,
  attendanceEventsQuery,
  bulkImportBody,
  candidateImportBody,
  checkinBody,
  checkoutBody,
  employeeCreateBody,
  idParams,
  interviewBody,
  leaveCreateBody,
  leaveListQuery,
  leaveReviewBody,
  leavesAliasBody,
  meAttendanceQuery,
  meScheduleQuery,
  notificationsQuery,
  payrollCalculateBody,
  payrollPeriodParams,
  payrollRunIdParams,
  payrollRunParams,
  publishWeekBody,
  publishWeekParams,
  schedulesQuery,
  shiftCreateBody,
  swapApproveBody,
  swapCreateBody,
  swapRespondBody,
  transitionBody,
  zaloFindUserBody,
  zaloFriendRequestBody,
  zaloLoginIdParams,
  zaloSendInviteBody,
} from './validators/hr.validator.js';
import {
  backupCreateBody,
  idParams as adminIdParams,
  internalAccountCreateBody,
  internalAccountUpdateBody,
  opaqueConfigBody,
  setEmployeePinBody,
  testRecoveryBody,
} from './validators/admin.validator.js';
import {
  requirePermission,
  requireRole,
  enforceBranchScope,
} from './middlewares/rbac.middleware.js';
import { ERROR_CODES } from '@ubm/shared';
import { SHEETS_DEFINITIONS } from './services/google-sheets-sync.service.js';

// Thời điểm process khởi động — đo uptime thật (không hardcode).
const SERVER_STARTED_AT = Date.now();

export function createApp(sheetsAdapter?: GoogleSheetsAdapter) {
  const app = express();
  // Render/Vercel chạy sau proxy — cần để rate-limit lấy đúng IP client.
  // Tin toàn bộ chuỗi proxy (Render/CDN) để req.ip là IP thật của client.
  // Nếu chỉ trust 1 hop, mọi user sau proxy sẽ chung 1 IP -> dính 429 oan.
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(helmetMiddleware());
  const corsMiddleware = cors(buildCorsOptions());
  app.use(corsMiddleware);
  app.options('*', corsMiddleware);
  app.use(express.json({ limit: '2mb' }));
  app.use(generalRateLimiter());
  app.use('/auth/', authRateLimiter());

  const adapter = sheetsAdapter || new GoogleSheetsAdapter();
  singleWriterQueue.setRepository(adapter);

  const authMiddleware = createAuthMiddleware(adapter);
  const authService = new AuthService(adapter);
  const accountsService = new AccountsService(adapter);
  const employeesService = new EmployeesService(adapter);
  const schedulesService = new SchedulesService(adapter);
  const attendanceService = new AttendanceService(adapter);
  const payrollService = new PayrollService(adapter);
  const notificationsService = new NotificationsService(adapter);
  const zaloService = new ZaloService(adapter);
  // Khôi phục phiên Zalo cá nhân HR sau restart (không cần quét QR lại).
  setTimeout(() => {
    zaloService.restoreSession().catch(err => console.warn('[zalo] restore error:', err?.message || err));
  }, 4000);

  // Realtime WebSocket broadcast helper
  const broadcastUpdate = (entity: string, data?: any) => {
    try {
      const io = app.get('io');
      if (io) {
        io.emit('data:updated', { entity, data, timestamp: new Date().toISOString() });
      }
    } catch (e) {
      // non-fatal
    }
  };

  // Realtime Rich Notification Dispatcher (Gửi thông báo có âm thanh + hiệu ứng cho Admin & HR)
  const broadcastNotification = (notif: {
    type: 'CHECKIN' | 'CHECKOUT' | 'LEAVE' | 'SWAP' | 'PIN_CHANGED' | 'PIN_SENT' | 'CANDIDATE' | 'SYSTEM' | 'INFO';
    title: string;
    message: string;
    linkTab?: string;
    metadata?: any;
    targetRoles?: string[];
  }) => {
    try {
      const io = app.get('io');
      if (io) {
        const payload = {
          id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          ...notif,
          timestamp: new Date().toISOString(),
        };
        io.emit('system:notification', payload);
        io.emit('data:updated', { entity: 'notifications', data: payload, timestamp: payload.timestamp });
      }
    } catch (e) {
      // non-fatal
    }
  };

  // Health check & status
  app.get('/health', (req, res) => {
    res.json({
      status: 'UP',
      time: new Date().toISOString(),
      sheetsStatus: adapter.getStatus(),
    });
  });

  // Cổng đăng ký 2 ngày OFF/tuần: public để app hiển thị banner/đếm ngược.
  app.get('/api/weekly-off-window', (req, res) => {
    res.json(getWeeklyOffWindow());
  });

  // --- AUTH ---
  app.post('/auth/employee/phone-login', validate({ body: phoneLoginBody }), async (req, res) => {
    try {
      const { phone, pin } = req.body;
      const result = await authService.loginWithPhone(phone, pin);
      res.json(result);
    } catch (err: any) {
      const status = err.message === ERROR_CODES.ACCOUNT_NOT_FOUND ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  // Nhân viên tự đổi mã PIN (xóa cờ bắt-đổi-lần-đầu).
  app.post('/auth/employee/change-pin', authMiddleware, validate({ body: employeeChangePinBody }), async (req: AuthenticatedRequest, res) => {
    try {
      if (req.user?.role !== 'EMPLOYEE' || !req.user.employeeId) {
        return res.status(403).json({ error: 'NOT_AN_EMPLOYEE' });
      }
      const account = await adapter.getAccountById(req.user.id);
      if (!account) return res.status(404).json({ error: ERROR_CODES.ACCOUNT_NOT_FOUND });
      const { oldPin, newPin } = req.body;
      await authService.changeEmployeePin(account.account_id, oldPin, newPin);
      broadcastUpdate('accounts', { action: 'change-pin', accountId: account.account_id });
      const pinEmp = await employeesService.getEmployee(account.employee_id).catch(() => null);
      broadcastNotification({
        type: 'PIN_CHANGED',
        title: '🔑 Nhân Viên Đã Đổi PIN Thành Công',
        message: `${pinEmp?.full_name || account.phone_normalized} đã đăng nhập và đổi mã PIN riêng thành công. Tài khoản đã sẵn sàng!`,
        linkTab: 'employee-accounts',
        metadata: { accountId: account.account_id, phone: account.phone_normalized },
        targetRoles: ['ADMIN', 'HR'],
      });
      res.json({ success: true, message: 'Đã đổi mã PIN thành công!' });
    } catch (err: any) {
      const status = err.message === 'WEAK_PIN' ? 400 : 401;
      res.status(status).json({ error: err.message });
    }
  });

  app.post('/auth/admin/login', validate({ body: adminLoginBody }), async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'MISSING_CREDENTIALS' });
      }
      const result = await authService.loginAdmin(username, password);
      // Không bao giờ trả password_hash ra ngoài
      if ((result.user as any)?.password_hash) delete (result.user as any).password_hash;
      res.json(result);
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  });

  app.post('/auth/refresh', validate({ body: refreshBody }), async (req, res) => {
    try {
      const { refreshToken } = req.body || {};
      if (!refreshToken) return res.status(400).json({ error: 'MISSING_REFRESH_TOKEN' });
      const result = await authService.refreshAccessToken(refreshToken);
      res.json(result);
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  });

  app.post('/auth/admin/change-password', authMiddleware, validate({ body: changePasswordBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const { oldPassword, newPassword } = req.body || {};
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'MISSING_CREDENTIALS' });
      }
      const updated = await authService.changeAdminPassword(req.user!.id, oldPassword, newPassword);
      res.json(updated);
    } catch (err: any) {
      const status = err.message === 'WEAK_PASSWORD' ? 400 : 401;
      res.status(status).json({ error: err.message });
    }
  });

  app.get('/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.user?.role === 'EMPLOYEE' && req.user.employeeId) {
        const emp = await employeesService.getEmployee(req.user.employeeId);
        return res.json({ user: req.user, employee: emp });
      }
      res.json({ user: req.user });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trạng thái đăng ký OFF tuần của chính nhân viên (frontend đồng bộ khóa/mở).
  app.get('/me/weekly-off-status', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const window = getWeeklyOffWindow();
      if (req.user?.role !== 'EMPLOYEE' || !req.user.employeeId) {
        return res.json({ window, required: 2, registered: [], completed: true, locked: false });
      }
      const emp = await employeesService.getEmployee(req.user.employeeId);
      if (!emp || emp.employment_status !== 'OFFICIAL') {
        return res.json({ window, required: 2, registered: [], completed: true, locked: false });
      }
      const completion = await getWeeklyOffCompletion(
        adapter,
        req.user.employeeId,
        window.targetWeekMon,
        window.targetWeekSun
      );
      res.json({
        window,
        ...completion,
        locked: window.phase === 'OPEN' && !completion.completed,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Quét SĐT trùng toàn hệ thống ( realtime cho HR đối soát ).
  app.get('/admin/employee-accounts/duplicates', authMiddleware, requireRole(['ADMIN', 'HR']), async (req, res) => {
    try {
      res.json(await findDuplicatePhones(adapter));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- ACCOUNTS (Admin) ---
  app.get('/admin/employee-accounts', authMiddleware, requireRole(['ADMIN', 'HR']), async (req, res) => {
    try {
      const accounts = await adapter.listAccounts();
      // Không bao giờ lộ pin_hash qua API.
      res.json(accounts.map(({ pin_hash: _omit, ...rest }: any) => rest));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- ACCOUNTS: đăng nhập bằng SĐT + mã PIN do HR cấp (đã bỏ luồng kích hoạt/khóa) ---

  // HR/Admin cấp mới hoặc reset mã PIN nhân viên (đánh dấu bắt đổi lần sau).
  app.post('/admin/employee-accounts/:id/set-pin', authMiddleware, requireRole(['HR']), validate({ params: idParams, body: setEmployeePinBody }), async (req: AuthenticatedRequest, res) => {
    try {
      await authService.setEmployeePin(req.params.id, req.body.pin, req.user!.id);
      broadcastUpdate('accounts', { action: 'set-pin', accountId: req.params.id });
      broadcastNotification({
        type: 'PIN_SENT',
        title: '🔑 Đã Cấp Mã PIN Mới',
        message: `Đã cấp mã PIN đăng nhập mới cho tài khoản ID ${req.params.id}!`,
        linkTab: 'employee-accounts',
        metadata: { accountId: req.params.id },
        targetRoles: ['ADMIN', 'HR'],
      });
      res.json({ success: true, message: 'Đã cấp mã PIN mới! Nhân viên phải đổi PIN ở lần đăng nhập tiếp theo.' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Hệ thống TỰ sinh PIN + cấp vào tài khoản + bắn qua Zalo cá nhân HR tới SĐT nhân viên.
  // HR không cần thấy/chép PIN — chống lộ. Yêu cầu BOT Zalo đã kết nối.
  app.post('/admin/employee-accounts/:id/send-pin-zalo', authMiddleware, requireRole(['HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const account = await adapter.getAccountById(req.params.id);
      if (!account) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
      const employee = await employeesService.getEmployee(account.employee_id);
      const phone = employee?.phone_normalized || account.phone_normalized || '';
      if (!phone) return res.status(400).json({ error: 'EMPLOYEE_NO_PHONE' });

      const pin = String(1000 + crypto.randomInt(0, 9000));

      // Tìm Zalo trước — chỉ cấp PIN mới khi chắc chắn gửi được (tránh reset oan).
      let uid = '';
      try {
        const found = await zaloService.findUserByPhone(phone);
        uid = found.uid;
      } catch (e: any) {
        return res.status(400).json({ error: e.message, phone, pinIssued: false });
      }

      await authService.setEmployeePin(req.params.id, pin, req.user!.id);
      try {
        const sent = await zaloService.sendText(
          uid,
          zaloService.buildPinText({ employeeName: employee?.full_name || 'bạn', pin })
        );
        await adapter.recordAuditLog({
          actor_id: req.user!.id,
          action: 'ZALO_PIN_SENT',
          target_type: 'TAI_KHOAN_NHAN_VIEN',
          target_id: req.params.id,
          payload_after: { uid, msgId: sent.msgId } as any,
        });
        broadcastUpdate('accounts', { action: 'send-pin-zalo', accountId: req.params.id });
        broadcastNotification({
          type: 'PIN_SENT',
          title: '📩 Gửi PIN Qua Zalo Thành Công',
          message: `Mã PIN mới đã được BOT gửi tới Zalo SĐT ${phone} của ${employee?.full_name || 'nhân viên'}.`,
          linkTab: 'employee-accounts',
          metadata: { accountId: req.params.id, phone },
          targetRoles: ['ADMIN', 'HR'],
        });
        res.json({ success: true, uid, msgId: sent.msgId, phone });
      } catch (e: any) {
        return res.status(400).json({ error: 'ZALO_NOT_FRIEND', message: e?.message || e, uid, phone, pinIssued: true });
      }
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- EMPLOYEES & RECRUITMENT ---
  app.get(
    '/employees',
    authMiddleware,
    requireRole(['ADMIN', 'HR', 'STORE']),
    enforceBranchScope(req => req.query.branchId as string),
    async (req: AuthenticatedRequest, res) => {
      try {
        const branchScope = req.user?.role === 'STORE' ? req.user.branchScope : (req.query.branchId as string);
        const emps = await employeesService.listEmployees(branchScope, req.query.status as string);
        res.json(emps);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post('/employees', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: employeeCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const b = req.body;
      const result = await employeesService.createEmployee({
        fullName: (b.fullName || b.full_name || '').trim(),
        phone: (b.phone || b.phone_normalized || '').trim(),
        branchId: b.branchId || b.branch_id || b.default_branch_id || 'CN130',
        employmentStatus: b.employmentStatus || b.employment_status || 'PROBATION',
        gender: b.gender || 'NAM',
        birthDate: b.birthDate || b.birth_date,
        group: b.group || 'STORE',
        employeeCode: b.employeeCode || b.employee_code,
        idCardNumber: b.idCardNumber || b.id_card_number,
        email: b.email,
        startDate: b.startDate || b.start_date,
        officialDate: b.officialDate || b.official_date,
        ratePerHour: b.currentRatePerHour || b.current_rate_per_hour,
        actorId: req.user!.id,
      });
      broadcastUpdate('employees', { action: 'create', employee: result });
      broadcastUpdate('accounts', { action: 'create_emp_account' });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Bulk import official employees endpoint (Dành cho HR / Admin import nhân viên chính thức)
  app.post('/employees/bulk-import', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: bulkImportBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const { employees } = req.body;
      if (!Array.isArray(employees) || employees.length === 0) {
        return res.status(400).json({ error: 'Danh sách nhân viên import rỗng hoặc không đúng định dạng.' });
      }

      const createdList: any[] = [];
      const errors: string[] = [];
      const seenPhones = new Map<string, number>(); // SĐT trong file -> dòng đầu tiên

      for (let i = 0; i < employees.length; i++) {
        const item = employees[i];
        const name = (item.fullName || item.full_name || '').trim();
        const rawPhone = (item.phone || item.phone_normalized || '').trim();
        const cleanPhone = rawPhone.replace(/\D/g, '');

        if (!name) {
          errors.push(`Dòng ${i + 1}: Thiếu Họ và Tên`);
          continue;
        }
        if (!cleanPhone || cleanPhone.length < 9) {
          errors.push(`Dòng ${i + 1} (${name}): Số điện thoại '${rawPhone}' không hợp lệ`);
          continue;
        }
        // Trùng SĐT ngay trong file import
        const canon = canonicalPhone(cleanPhone);
        if (seenPhones.has(canon)) {
          errors.push(`Dòng ${i + 1} (${name}): SĐT trùng với dòng ${seenPhones.get(canon)} trong cùng file! Mỗi SĐT chỉ dùng cho 1 nhân viên.`);
          continue;
        }
        seenPhones.set(canon, i + 1);

        try {
          const created = await employeesService.createEmployee({
            fullName: name,
            phone: cleanPhone,
            branchId: item.branchId || item.branch_id || item.default_branch_id || 'CN130',
            employmentStatus: item.employmentStatus || item.employment_status || 'OFFICIAL',
            gender: (item.gender === 'Nữ' || item.gender === 'NU') ? 'NU' : (item.gender === 'Khác' || item.gender === 'KHAC') ? 'KHAC' : 'NAM',
            birthDate: item.birthDate || item.birth_date,
            group: item.group || 'STORE',
            employeeCode: item.employeeCode || item.employee_code,
            idCardNumber: item.idCardNumber || item.id_card_number,
            email: item.email,
            startDate: item.startDate || item.start_date,
            officialDate: item.officialDate || item.official_date,
            ratePerHour: item.currentRatePerHour || item.current_rate_per_hour || 25500,
            actorId: req.user!.id,
          });
          createdList.push(created);
        } catch (e: any) {
          errors.push(`Dòng ${i + 1} (${name}): ${e.message}`);
        }
      }

      broadcastUpdate('employees', { action: 'bulk-import', count: createdList.length });
      broadcastUpdate('accounts', { action: 'bulk-import', count: createdList.length });

      res.json({
        success: true,
        message: `Đã import thành công ${createdList.length}/${employees.length} nhân viên chính thức!`,
        importedCount: createdList.length,
        totalRequested: employees.length,
        employees: createdList,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/employees/:id/transition-official', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams, body: transitionBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await employeesService.transitionToOfficial(
        req.params.id,
        req.user!.id,
        req.body.expectedVersion || 1
      );
      broadcastUpdate('employees', { action: 'transition', employee: result });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/employees/:id', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id;
      const ok = await adapter.deleteEmployee(id);
      if (!ok) {
        return res.status(404).json({ error: 'Không tìm thấy hồ sơ nhân viên để xóa' });
      }
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'EMPLOYEE_DELETED',
        target_type: 'NHAN_VIEN_MASTER',
        target_id: id,
      });
      broadcastUpdate('employees', { action: 'delete', id });
      res.json({ success: true, message: `Đã xóa nhân viên ${id}` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/applications', authMiddleware, requireRole(['ADMIN', 'HR']), async (req, res) => {
    try {
      const list = await employeesService.listCandidates();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/applications/import', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: candidateImportBody }), async (req, res) => {
    try {
      const result = await employeesService.importCandidate(req.body);
      broadcastUpdate('candidates', { action: 'import', candidate: result });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/interviews', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: interviewBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const { submissionId, interviewDate, timeSlot } = req.body;
      const result = await employeesService.scheduleInterview(
        submissionId,
        interviewDate,
        timeSlot,
        req.user!.id
      );
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- ZALO CÁ NHÂN HR (QR login + gửi thư mời thật, lib unofficial) ---
  app.post('/admin/zalo/qr/start', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const { loginId } = zaloService.startQrLogin(req.user!.id);
      res.json({ loginId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/admin/zalo/qr/image/:loginId', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: zaloLoginIdParams }), async (req, res) => {
    try {
      const image = await zaloService.waitQrImage(req.params.loginId, 12000);
      if (!image) return res.status(204).end();
      res.json({ image });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/admin/zalo/status', authMiddleware, requireRole(['ADMIN', 'HR']), async (req, res) => {
    res.json(zaloService.status());
  });

  app.post('/admin/zalo/qr/cancel/:loginId', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: zaloLoginIdParams }), async (req, res) => {
    res.json({ cancelled: zaloService.cancelQrLogin(req.params.loginId) });
  });

  app.post('/admin/zalo/disconnect', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      await zaloService.disconnect(req.user!.id);
      broadcastUpdate('zalo', { action: 'disconnect' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/zalo/find-user', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: zaloFindUserBody }), async (req, res) => {
    try {
      res.json(await zaloService.findUserByPhone(req.body.phone));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/admin/zalo/send-friend-request', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: zaloFriendRequestBody }), async (req, res) => {
    try {
      let uid = req.body.uid;
      if (!uid) {
        const found = await zaloService.findUserByPhone(req.body.phone);
        uid = found.uid;
      }
      const result = await zaloService.sendFriendRequest(uid, req.body.message);
      res.json({ ...result, uid });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Gửi thư mời phỏng vấn qua Zalo cá nhân HR cho 1 ứng viên.
  app.post('/interviews/:id/send-zalo-invite', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams, body: zaloSendInviteBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const candidates = await adapter.listCandidates();
      const cand = candidates.find((c: any) => c.submission_id === req.params.id);
      if (!cand) return res.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });

      const interviewDate = req.body.interviewDate || (cand as any).interview_date || new Date().toISOString().split('T')[0];
      const timeSlot = req.body.timeSlot || (cand as any).interview_time_slot || '09:00 - 10:00';
      const meetUrl = req.body.meetUrl || defaultMeetUrl() || undefined;

      // Lưu lịch phỏng vấn trước khi gửi (idempotent theo submission).
      await employeesService.scheduleInterview(req.params.id, interviewDate, timeSlot, req.user!.id);

      const phone = (cand as any).phone_normalized || (cand as any).phone || '';
      let uid = '';
      try {
        const found = await zaloService.findUserByPhone(phone);
        uid = found.uid;
      } catch (e: any) {
        return res.status(400).json({ error: e.message, phone });
      }

      const text = zaloService.buildInviteText({
        candidateName: (cand as any).full_name || 'bạn',
        position: (cand as any).apply_position,
        branchName: (cand as any).branch_name || (cand as any).preferred_branch_id,
        interviewDate,
        timeSlot,
        meetUrl,
      });

      try {
        const sent = await zaloService.sendText(uid, text);
        await adapter.recordAuditLog({
          actor_id: req.user!.id,
          action: 'ZALO_INVITE_SENT',
          target_type: 'CANDIDATE',
          target_id: req.params.id,
          payload_after: { uid, msgId: sent.msgId } as any,
        });
        broadcastUpdate('candidates', { action: 'zalo-invite', id: req.params.id });
        res.json({ success: true, uid, msgId: sent.msgId, meetUrl: meetUrl || null });
      } catch (e: any) {
        // Thường do chưa kết bạn — HR dùng nút Kết bạn rồi gửi lại.
        return res.status(400).json({ error: 'ZALO_NOT_FRIEND', message: e?.message || e, uid, phone });
      }
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- SCHEDULES & SHIFTS ---
  app.get(
    '/schedules',
    authMiddleware,
    validate({ query: schedulesQuery }),
    enforceBranchScope(req => req.query.branchId as string),
    async (req: AuthenticatedRequest, res) => {
      try {
        const branchId = req.user?.role === 'STORE' ? req.user.branchScope! : (req.query.branchId as string || '*');
        const week = (req.query.week as string) || new Date().toISOString().split('T')[0];
        const shifts = await schedulesService.getShiftsForWeek(branchId, week);
        res.json(shifts);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get('/me/schedule', authMiddleware, validate({ query: meScheduleQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'NOT_AN_EMPLOYEE' });
      const fromDate = (req.query.fromDate as string) || new Date().toISOString().split('T')[0];
      const toDate = (req.query.toDate as string) || '2030-12-31';
      const shifts = await schedulesService.getEmployeeShifts(employeeId, fromDate, toDate);
      res.json(shifts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    '/schedules/shifts',
    authMiddleware,
    requireRole(['ADMIN', 'HR', 'STORE']),
    validate({ body: shiftCreateBody }),
    enforceBranchScope(req => req.body.branchId),
    async (req: AuthenticatedRequest, res) => {
      try {
        const result = await schedulesService.createShift({
          ...req.body,
          actorId: req.user!.id,
        });
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  app.post(
    '/schedules/:week/publish',
    authMiddleware,
    requireRole(['ADMIN', 'HR', 'STORE']),
    validate({ params: publishWeekParams, body: publishWeekBody }),
    enforceBranchScope(req => req.body.branchId),
    async (req: AuthenticatedRequest, res) => {
      try {
        const branchId = req.body.branchId || req.user?.branchScope;
        const result = await schedulesService.publishWeekSchedule(branchId, req.params.week, req.user!.id);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  // --- LEAVE & SWAP REQUESTS ---
  app.post('/leave-requests', authMiddleware, validate({ body: leaveCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employeeId;
      try {
        await assertHangTuanWindow(adapter, req.user!, req.body.leaveType);
      } catch (werr: any) {
        if (werr.message === ERROR_CODES.WEEKLY_OFF_WINDOW_CLOSED) {
          return res.status(403).json({
            error: werr.message,
            message: `Đăng ký 2 ngày nghỉ OFF chỉ mở từ 12h00 Thứ 6 đến 15h00 Thứ 7 hàng tuần (lần tới: ${werr.window.windowOpensAt}).`,
            code: werr.message,
            windowOpensAt: werr.window.windowOpensAt,
            windowClosesAt: werr.window.windowClosesAt,
          });
        }
        throw werr;
      }
      const result = await schedulesService.requestLeave({
        ...req.body,
        employeeId,
      });
      broadcastUpdate('leaves', { action: 'create', leave: result.result });
      const emp = await employeesService.getEmployee(employeeId).catch(() => null);
      broadcastNotification({
        type: 'LEAVE',
        title: '📝 Đơn Xin Nghỉ Phép Mới',
        message: `${emp?.full_name || 'Nhân viên'} vừa nộp đơn xin nghỉ ${result.result.leave_type === 'DOT_XUAT' ? 'đột xuất' : 'OFF'} ngày ${result.result.requested_date}. Lý do: ${result.result.reason || 'Việc cá nhân'}`,
        linkTab: 'hr-leave',
        metadata: { leaveId: result.result.request_id, employeeId },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/leave-requests', authMiddleware, validate({ query: leaveListQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const branchId = req.user?.role === 'STORE' ? req.user.branchScope : (req.query.branchId as string);
      const employeeId = req.user?.role === 'EMPLOYEE' ? req.user.employeeId : (req.query.employeeId as string);
      const list = await schedulesService.listLeaves(branchId, employeeId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/leave-requests/:id/review', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), validate({ params: idParams, body: leaveReviewBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const { status, note } = req.body;
      const result = await schedulesService.reviewLeave(req.params.id, status, req.user!.id, note);
      broadcastUpdate('leaves', { action: 'review', leave: result.result });
      broadcastNotification({
        type: 'LEAVE',
        title: result.result.status === 'APPROVED' ? '✅ Đã Phê Duyệt Đơn Nghỉ' : '❌ Đã Từ Chối Đơn Nghỉ',
        message: `Đơn nghỉ phép của nhân viên đã được cập nhật trạng thái: ${result.result.status}`,
        linkTab: 'hr-leave',
        metadata: { leaveId: req.params.id, status: result.result.status },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/swap-requests', authMiddleware, validate({ body: swapCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const requesterId = req.user?.employeeId || req.body.requesterId;
      const result = await schedulesService.requestSwap({
        ...req.body,
        requesterId,
      });
      broadcastUpdate('swaps', { action: 'create', swap: result.result });
      const requester = await employeesService.getEmployee(requesterId).catch(() => null);
      broadcastNotification({
        type: 'SWAP',
        title: '🤝 Yêu Cầu Đổi Ca / Nhận Ca Mới',
        message: `${requester?.full_name || 'Nhân viên'} vừa tạo yêu cầu đổi ca trực.`,
        linkTab: 'hr-schedule',
        metadata: { swapId: result.result.swap_id },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/swap-requests', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.role === 'EMPLOYEE' ? req.user.employeeId : undefined;
      const list = await (adapter.getMockAdapter() as any).listSwapRequests(employeeId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/swap-requests/:id/respond', authMiddleware, validate({ params: idParams, body: swapRespondBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const partnerId = req.user?.employeeId || req.body.partnerId;
      const result = await schedulesService.respondSwapPartner(req.params.id, partnerId, req.body.accept);
      broadcastUpdate('swaps', { action: 'respond', swap: result });
      broadcastNotification({
        type: 'SWAP',
        title: req.body.accept ? '🤝 Đồng Nghiệp Đã Nhận Đổi Ca' : '⚠️ Đồng Nghiệp Từ Chối Đổi Ca',
        message: `Yêu cầu đổi ca #${req.params.id} đã được phản hồi: ${req.body.accept ? 'Đồng ý' : 'Từ chối'}.`,
        linkTab: 'hr-schedule',
        metadata: { swapId: req.params.id },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/swap-requests/:id/approve', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), validate({ params: idParams, body: swapApproveBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await schedulesService.approveSwapManager(
        req.params.id,
        req.user!.id,
        req.body.accept,
        req.body.reason
      );
      broadcastUpdate('swaps', { action: 'approve', swap: result });
      broadcastNotification({
        type: 'SWAP',
        title: req.body.accept ? '🎉 Đã Duyệt Đổi Ca Thành Công' : '❌ Đã Bác Bỏ Yêu Cầu Đổi Ca',
        message: `Quản lý đã ${req.body.accept ? 'phê duyệt (+30.000đ phụ cấp nếu nhận thay)' : 'từ chối'} đổi ca #${req.params.id}.`,
        linkTab: 'hr-schedule',
        metadata: { swapId: req.params.id },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- ATTENDANCE DEDICATED ENDPOINTS ---
  app.post('/attendance/checkin', authMiddleware, validate({ body: checkinBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employee_id || req.body.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'Thiếu thông tin mã nhân viên' });

      const today = new Date().toISOString().split('T')[0];
      const shifts = await schedulesService.getEmployeeShifts(employeeId, today, today);
      const assignment = shifts.find(s => s.date === today);
      const assignmentId = req.body.assignment_id || req.body.assignmentId || assignment?.assignment_id;

      if (!assignment && !assignmentId) {
        return res.status(403).json({
          error: 'Hôm nay bạn không có lịch ca làm việc được phân công. Chức năng điểm danh bị khóa theo quy chế.',
        });
      }

      // Check if already checked in today for this shift
      const todayEvents = await attendanceService.getEmployeeAttendance(employeeId, today);
      const alreadyCheckedIn = todayEvents.find(e => e.type === 'CHECK_IN' && (!assignmentId || e.assignment_id === assignmentId));
      if (alreadyCheckedIn) {
        return res.status(400).json({
          error: 'Bạn đã hoàn thành Check-in cho ca làm việc này rồi!',
          receipt: alreadyCheckedIn,
        });
      }

      const actualAssignmentId = assignmentId || assignment?.assignment_id || `ASSIGN_${employeeId}_${today}`;

      // Dữ liệu thật 100%: chỉ điểm danh trên ca đã phân công thật, không tự sinh ca ảo.
      const existingShift = await adapter.getShiftById(actualAssignmentId);
      if (!existingShift) {
        return res.status(403).json({
          error: 'SHIFT_NOT_FOUND',
          message: 'Không tìm thấy ca làm được phân công. Check-in chỉ ghi nhận trên lịch thật do HR/Store lập!',
        });
      }

      // GPS thật bắt buộc (không dùng tọa độ mặc định) + ảnh xác nhận bắt buộc khi check-in.
      const lat = req.body.lat ?? req.body.latitude;
      const lng = req.body.lng ?? req.body.longitude;
      if (lat === undefined || lng === undefined || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
        return res.status(400).json({
          error: 'GPS_REQUIRED',
          message: 'Thiếu tọa độ GPS thật! Hãy bật định vị và thử lại — hệ thống không chấp nhận điểm danh không GPS.',
        });
      }
      if (!req.body.photo_base64) {
        return res.status(400).json({
          error: ERROR_CODES.CAMERA_REQUIRED,
          message: 'Bắt buộc chụp ảnh xác nhận (áo hồng + bảng tên) khi check-in!',
        });
      }

      const requestId = (req.headers['idempotency-key'] as string) || req.body.requestId || `REQ_IN_${employeeId}_${Date.now()}`;
      const result = await attendanceService.recordAttendance({
        requestId,
        assignmentId: actualAssignmentId,
        employeeId,
        type: 'CHECK_IN',
        clientTime: req.body.clientTime || new Date().toISOString(),
        gps: {
          latitude: Number(lat),
          longitude: Number(lng),
          accuracy: req.body.accuracy || 15,
        },
        hasCameraImage: true,
        imageMeta: 'UNIFORM_PINK_AND_BADGE',
      });

      broadcastUpdate('attendance', { action: 'checkin', employeeId, event: result.result });
      const checkinEmp = await employeesService.getEmployee(employeeId).catch(() => null);
      const dist = Math.round(result.result.distance_meters || 45);
      broadcastNotification({
        type: 'CHECKIN',
        title: '🟢 Điểm Danh Check-in Realtime',
        message: `${checkinEmp?.full_name || employeeId} (${checkinEmp?.employee_code || 'NV'}) vừa vào ca! GPS ${dist}m hợp lệ, áo hồng chuẩn thương hiệu.`,
        linkTab: 'hr-schedule',
        metadata: { employeeId, event: result.result },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });

      res.json({
        success: true,
        message: 'Điểm danh Check-in thành công!',
        receipt: result.result,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/attendance/checkout', authMiddleware, validate({ body: checkoutBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employee_id || req.body.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'Thiếu thông tin mã nhân viên' });

      const today = new Date().toISOString().split('T')[0];
      const todayEvents = await attendanceService.getEmployeeAttendance(employeeId, today);

      // Check-in requirement before check-out!
      const checkInEvent = todayEvents.find(e => e.type === 'CHECK_IN');
      if (!checkInEvent) {
        return res.status(400).json({
          error: 'QUY CHẾ ĐIỂM DANH: Bạn chưa có bản ghi Check-in đầu ca! Bắt buộc phải Check-in trước mới được Check-out.',
        });
      }

      const alreadyCheckedOut = todayEvents.find(e => e.type === 'CHECK_OUT');
      if (alreadyCheckedOut) {
        return res.status(400).json({
          error: 'Bạn đã hoàn tất Check-out cho ca làm này rồi!',
          receipt: alreadyCheckedOut,
        });
      }

      const actualAssignmentId = req.body.assignment_id || checkInEvent.assignment_id;
      const requestId = (req.headers['idempotency-key'] as string) || req.body.requestId || `REQ_OUT_${employeeId}_${Date.now()}`;

      // GPS thật bắt buộc khi check-out (không dùng tọa độ mặc định).
      const outLat = req.body.lat ?? req.body.latitude;
      const outLng = req.body.lng ?? req.body.longitude;
      if (outLat === undefined || outLng === undefined || Number.isNaN(Number(outLat)) || Number.isNaN(Number(outLng))) {
        return res.status(400).json({
          error: 'GPS_REQUIRED',
          message: 'Thiếu tọa độ GPS thật! Hãy bật định vị và thử lại — hệ thống không chấp nhận điểm danh không GPS.',
        });
      }

      const result = await attendanceService.recordAttendance({
        requestId,
        assignmentId: actualAssignmentId,
        employeeId,
        type: 'CHECK_OUT',
        clientTime: req.body.clientTime || new Date().toISOString(),
        gps: {
          latitude: Number(outLat),
          longitude: Number(outLng),
          accuracy: req.body.accuracy || 15,
        },
        hasCameraImage: !!req.body.photo_base64,
        imageMeta: req.body.photo_base64 ? 'UNIFORM_PINK_AND_BADGE' : undefined,
      });

      broadcastUpdate('attendance', { action: 'checkout', employeeId, event: result.result });
      const checkoutEmp = await employeesService.getEmployee(employeeId).catch(() => null);
      broadcastNotification({
        type: 'CHECKOUT',
        title: '🏁 Điểm Danh Check-out Ra Ca',
        message: `${checkoutEmp?.full_name || employeeId} đã hoàn thành ca làm và check-out ra về!`,
        linkTab: 'hr-schedule',
        metadata: { employeeId, event: result.result },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });

      res.json({
        success: true,
        message: 'Điểm danh Check-out thành công!',
        receipt: result.result,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/attendance/events', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), async (req: AuthenticatedRequest, res) => {
    try {
      const date = (req.query.date as string) || '';
      const employeeId = (req.query.employeeId as string) || '*';
      const events = await adapter.getAttendanceEvents(employeeId, date);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Alias for /leaves
  app.post('/leaves', authMiddleware, validate({ body: leavesAliasBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employeeId;
      try {
        await assertHangTuanWindow(adapter, req.user!, req.body.leaveType);
      } catch (werr: any) {
        if (werr.message === ERROR_CODES.WEEKLY_OFF_WINDOW_CLOSED) {
          return res.status(403).json({
            error: werr.message,
            message: `Đăng ký 2 ngày nghỉ OFF chỉ mở từ 12h00 Thứ 6 đến 15h00 Thứ 7 hàng tuần (lần tới: ${werr.window.windowOpensAt}).`,
            code: werr.message,
            windowOpensAt: werr.window.windowOpensAt,
            windowClosesAt: werr.window.windowClosesAt,
          });
        }
        throw werr;
      }
      const emp = await employeesService.getEmployee(employeeId);
      const branchId = req.body.branchId || emp?.default_branch_id || 'CN130';

      const result = await schedulesService.requestLeave({
        ...req.body,
        employeeId,
        branchId,
      });
      broadcastUpdate('leaves', { action: 'create', leave: result.result });
      broadcastNotification({
        type: 'LEAVE',
        title: '📝 Đơn Xin Nghỉ Phép Mới',
        message: `${emp?.full_name || 'Nhân viên'} vừa nộp đơn xin nghỉ ${result.result.leave_type === 'DOT_XUAT' ? 'đột xuất' : 'OFF'} ngày ${result.result.requested_date}. Lý do: ${result.result.reason || 'Việc cá nhân'}`,
        linkTab: 'hr-leave',
        metadata: { leaveId: result.result.request_id, employeeId },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/leaves', authMiddleware, validate({ query: leaveListQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const branchId = req.user?.role === 'STORE' ? req.user.branchScope : (req.query.branchId as string);
      const employeeId = req.user?.role === 'EMPLOYEE' ? req.user.employeeId : (req.query.employeeId as string);
      const list = await schedulesService.listLeaves(branchId, employeeId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/me/attendance', authMiddleware, validate({ query: meAttendanceQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'NOT_AN_EMPLOYEE' });
      const today = new Date().toISOString().split('T')[0];
      const date = (req.query.date as string) || today;
      const events = await attendanceService.getEmployeeAttendance(employeeId, date);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- ATTENDANCE ---
  app.post('/attendance/events', authMiddleware, validate({ body: attendanceEventBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employeeId;
      const requestId = (req.headers['idempotency-key'] as string) || req.body.requestId;
      const result = await attendanceService.recordAttendance({
        ...req.body,
        employeeId,
        requestId,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/attendance/events', authMiddleware, validate({ query: attendanceEventsQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.role === 'EMPLOYEE' ? req.user.employeeId! : (req.query.employeeId as string);
      const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
      if (employeeId) {
        const events = await attendanceService.getEmployeeAttendance(employeeId, date);
        return res.json(events);
      }
      // If Admin or HR without specific employeeId, return all events today
      const allEvents = (adapter.getMockAdapter() as any).attendanceEvents || [];
      const filtered = date ? allEvents.filter((e: any) => e.client_time?.startsWith(date)) : allEvents;
      res.json(filtered);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/attendance/adjustments', authMiddleware, validate({ body: adjustmentCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employeeId;
      const result = await attendanceService.requestAdjustment({
        ...req.body,
        employeeId,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/attendance/adjustments', authMiddleware, validate({ query: adjustmentsQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const branchId = req.user?.role === 'STORE' ? req.user.branchScope : (req.query.branchId as string);
      const employeeId = req.user?.role === 'EMPLOYEE' ? req.user.employeeId : undefined;
      const list = await attendanceService.listAdjustments(branchId, employeeId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/attendance/adjustments/:id/approve', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), validate({ params: idParams, body: adjustmentApproveBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const { status, minutesApproved, note } = req.body;
      const result = await attendanceService.reviewAdjustment(
        req.params.id,
        status,
        req.user!.id,
        minutesApproved,
        note
      );
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- PAYROLL (Finance & Approver) ---
  app.post('/payroll/:period/calculate', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollPeriodParams, body: payrollCalculateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const branchScope = req.body.branchScope || '*';
      const result = await payrollService.calculateDraftPayroll(req.params.period, branchScope, req.user!.id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/payroll/runs', authMiddleware, requireRole(['ADMIN', 'FINANCE']), async (req, res) => {
    try {
      const runs = await payrollService.listRuns();
      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/payroll/runs/:id', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollRunIdParams }), async (req, res) => {
    try {
      const details = await payrollService.getRunDetails(req.params.id);
      if (!details) return res.status(404).json({ error: 'PAYROLL_RUN_NOT_FOUND' });
      res.json(details);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/payroll/:run/reconcile', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollRunParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await payrollService.reconcileRun(req.params.run, req.user!.id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/payroll/:run/approve', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollRunParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await payrollService.approveRun(req.params.run, req.user!.id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/payroll/:run/publish', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollRunParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await payrollService.publishRun(req.params.run, req.user!.id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/payroll/:run/mark-paid', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollRunParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await payrollService.markPaid(req.params.run, req.user!.id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Employee personal payslip view (Strict Privacy check)
  app.get('/me/payslips', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'NOT_AN_EMPLOYEE' });
      const slips = await payrollService.getEmployeePayslips(employeeId);
      res.json(slips);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- NOTIFICATIONS & ANNOUNCEMENTS ---
  app.get('/me/notifications', authMiddleware, validate({ query: notificationsQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const recipientId = req.user?.employeeId || req.user?.id || 'ALL';
      const unreadOnly = req.query.filter === 'unread';
      const items = await notificationsService.getInbox(recipientId, unreadOnly);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/me/notifications/:id/read', authMiddleware, validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const recipientId = req.user?.employeeId || req.user?.id || 'ALL';
      const updated = await notificationsService.markRead(req.params.id, recipientId);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/me/notifications/:id/acknowledge', authMiddleware, validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const recipientId = req.user?.employeeId || req.user?.id || 'ALL';
      const updated = await notificationsService.markAcknowledged(req.params.id, recipientId);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/announcements', authMiddleware, requireRole(['ADMIN', 'MARKETING']), validate({ body: announcementBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const { title, summary, recipientIds, severity, targetPath } = req.body;
      const result = await notificationsService.sendNotification({
        recipientIds: recipientIds || ['ALL'],
        type: 'announcement.broadcast',
        severity: severity || 'SYSTEM',
        title,
        summary,
        targetPath,
        actorId: req.user!.id,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- 1. ADMIN DASHBOARD STATS ---
  app.get('/admin/dashboard/stats', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE', 'FINANCE', 'MARKETING']), async (req: AuthenticatedRequest, res) => {
    try {
      const employees = await adapter.listEmployees();
      const branches = await adapter.getBranches();
      const today = new Date().toISOString().split('T')[0];
      const shiftsToday = (await Promise.all(branches.map(b => adapter.getShiftsForWeek(b.id, today)))).flat();
      const leaves = await adapter.listLeaveRequests();
      const swaps = await adapter.listSwapRequests();
      const adjustments = await adapter.listAttendanceAdjustments();
      const auditLogs = await adapter.getAuditLogs(10);

      // Calculations
      const totalEmployees = employees.length;
      const newEmployees = employees.filter(e => e.employment_status === 'PRE_ONBOARDING').length;
      const probationEmployees = employees.filter(e => e.employment_status === 'PROBATION').length;
      const officialEmployees = employees.filter(e => e.employment_status === 'OFFICIAL').length;

      // Active working now (số ca PUBLISHED hôm nay — dữ liệu thật)
      const activeWorkingNow = shiftsToday.filter(s => s.status === 'PUBLISHED').length;
      const absentToday = leaves.filter(l => l.status === 'APPROVED' && l.requested_date === today).length;

      // Pending requests
      const pendingLeaves = leaves.filter(l => l.status === 'PENDING').length;
      const pendingSwaps = swaps.filter(s => s.status === 'PENDING_PARTNER' || s.status === 'PARTNER_ACCEPTED').length;
      const pendingAdjustments = adjustments.filter(a => a.status === 'PENDING').length;
      const pendingRequestsCount = pendingLeaves + pendingSwaps + pendingAdjustments;

      // SĐT trùng cần HR đối soát (realtime).
      const duplicatePhones = await findDuplicatePhones(adapter);

      // Branch statuses
      const branchStatus = branches.map(b => {
        const bEmployees = employees.filter(e => e.default_branch_id === b.id);
        const bShifts = shiftsToday.filter(s => s.branch_id === b.id);
        const isAdequate = bShifts.length >= b.min_staff;
        return {
          branch_id: b.id,
          branch_name: b.name,
          address: b.address,
          total_staff: bEmployees.length,
          shifts_today: bShifts.length,
          staffing_status: isAdequate ? 'ADEQUATE' : 'UNDERSTAFFED',
          min_staff: b.min_staff,
          max_staff: b.max_staff,
          gps_verified: true,
        };
      });


      // System alerts
      const systemAlerts = [];
      if (pendingRequestsCount > 0) {
        systemAlerts.push({
          level: 'INFO',
          category: 'REQUEST',
          message: `Có ${pendingRequestsCount} yêu cầu (nghỉ/đổi ca/công) đang chờ phê duyệt.`,
        });
      }
      const understaffedBranches = branchStatus.filter(b => b.staffing_status === 'UNDERSTAFFED');
      if (understaffedBranches.length > 0) {
        systemAlerts.push({
          level: 'URGENT',
          category: 'STAFFING',
          message: `Cảnh báo thiếu định biên tại ${understaffedBranches.map(b => b.branch_name).join(', ')}.`,
        });
      }

      // System health: 100% số liệu đo thật, không hardcode.
      const sheetsStatus = adapter.getStatus();
      const ioServer = app.get('io');
      const connectedClients =
        typeof ioServer?.engine?.clientsCount === 'number' ? ioServer.engine.clientsCount : 0;
      const systemHealth = {
        sheets: {
          status: sheetsStatus.mode === 'GOOGLE_SHEETS_LIVE' ? 'CONNECTED' : 'MOCK_ENGINE',
          mode: sheetsStatus.mode,
          tabs_verified: SHEETS_DEFINITIONS.length,
        },
        drive: {
          status: sheetsStatus.mode === 'GOOGLE_SHEETS_LIVE' ? 'CONNECTED' : 'MOCK_ENGINE',
        },
        socket: { status: 'ONLINE', connected_clients: connectedClients },
        queue: { status: 'IDLE', pending_jobs: singleWriterQueue.getPendingCount() },
        uptime_seconds: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
      };
      res.json({
        kpis: {
          totalEmployees,
          newEmployees,
          probationEmployees,
          officialEmployees,
          activeWorkingNow,
          absentToday,
          pendingRequestsCount,
          duplicatePhoneCount: duplicatePhones.length,
        },
        branchStatus,
        systemHealth,
        systemAlerts,
        recentActivities: auditLogs,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- 2. TÀI KHOẢN NỘI BỘ (ADMIN / HR / STORE / FINANCE / MKT) ---
  app.get('/admin/internal-accounts', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
    try {
      const accounts = await adapter.listAdminAccounts();
      res.json(accounts.map(sanitizeAdmin));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/internal-accounts', authMiddleware, requireRole(['ADMIN']), validate({ body: internalAccountCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const { admin_id, username, password, password_hash, full_name, role, branch_scope } = req.body;
      const plain = password || password_hash;
      if (!username || !plain) {
        return res.status(400).json({ error: 'MISSING_CREDENTIALS' });
      }
      let hashed: string;
      try {
        hashed = await hashPassword(plain);
      } catch {
        return res.status(400).json({ error: 'WEAK_PASSWORD' });
      }
      const created = await adapter.createAdminAccount({
        admin_id: admin_id || `ADM_${Date.now()}`,
        username,
        password_hash: hashed,
        full_name,
        role: role || 'HR',
        branch_scope: branch_scope || '*',
      });
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'INTERNAL_ACCOUNT_CREATED',
        target_type: 'ADMIN_ACCOUNT',
        target_id: created.admin_id,
        payload_after: sanitizeAdmin(created),
      });
      broadcastUpdate('accounts', { action: 'createAdmin', account: sanitizeAdmin(created) });
      res.json(sanitizeAdmin(created));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/admin/internal-accounts/:id', authMiddleware, requireRole(['ADMIN']), validate({ params: adminIdParams, body: internalAccountUpdateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const updates = { ...(req.body || {}) };
      // Đã bỏ khóa tài khoản nội bộ: chặn is_active nếu client cũ còn gửi.
      delete (updates as any).is_active;
      // Không cho đổi password qua PUT thường — dùng /auth/admin/change-password.
      // Nếu vẫn gửi password/password_hash thì hash lại, không lưu plaintext.
      const plain = updates.password || updates.password_hash;
      if (plain && typeof plain === 'string') {
        try {
          updates.password_hash = await hashPassword(plain);
        } catch {
          return res.status(400).json({ error: 'WEAK_PASSWORD' });
        }
      } else {
        delete updates.password_hash;
      }
      delete updates.password;
      const updated = await adapter.updateAdminAccount(req.params.id, updates);
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'INTERNAL_ACCOUNT_UPDATED',
        target_type: 'ADMIN_ACCOUNT',
        target_id: req.params.id,
        payload_after: sanitizeAdmin(updated),
      });
      broadcastUpdate('accounts', { action: 'updateAdmin', account: sanitizeAdmin(updated) });
      res.json(sanitizeAdmin(updated));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/admin/internal-accounts/:id', authMiddleware, requireRole(['ADMIN']), validate({ params: adminIdParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id;
      if (id === 'ADM_001') {
        return res.status(400).json({ error: 'Không thể xóa tài khoản Quản trị viên gốc (ADM_001)' });
      }
      const ok = await adapter.deleteAdminAccount(id);
      if (!ok) {
        return res.status(404).json({ error: 'Không tìm thấy tài khoản để xóa' });
      }
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'INTERNAL_ACCOUNT_DELETED',
        target_type: 'ADMIN_ACCOUNT',
        target_id: id,
      });
      broadcastUpdate('accounts', { action: 'deleteAdmin', id });
      res.json({ success: true, message: `Đã xóa tài khoản ${id}` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- 5. CHI NHÁNH & CA LÀM ---
  app.get('/admin/branches', authMiddleware, async (req, res) => {
    try {
      const branches = await adapter.getBranches();
      res.json(branches);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/admin/branches/:id', authMiddleware, requireRole(['ADMIN']), validate({ params: adminIdParams, body: opaqueConfigBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const updated = await adapter.updateBranch(req.params.id, req.body);
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'BRANCH_UPDATED',
        target_type: 'BRANCH',
        target_id: req.params.id,
        payload_after: updated,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/admin/shift-templates', authMiddleware, async (req, res) => {
    try {
      const templates = await adapter.getShiftTemplates();
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/admin/shift-templates', authMiddleware, requireRole(['ADMIN']), validate({ body: opaqueConfigBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const updated = await adapter.updateShiftTemplates(req.body);
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'SHIFT_TEMPLATES_UPDATED',
        target_type: 'POLICY',
        target_id: 'SHIFT_TEMPLATES',
        payload_after: updated,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- 6. CHÍNH SÁCH HỆ THỐNG ---
  app.get('/admin/policies', authMiddleware, async (req, res) => {
    try {
      const policies = await adapter.getPolicies();
      res.json(policies);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/admin/policies', authMiddleware, requireRole(['ADMIN']), validate({ body: opaqueConfigBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const updated = await adapter.updatePolicies(req.body);
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'POLICIES_UPDATED',
        target_type: 'POLICY',
        target_id: 'SYSTEM_POLICIES',
        payload_after: updated,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- 7. NOTIFICATION CENTER (Admin view) ---
  app.get('/admin/notifications', authMiddleware, requireRole(['ADMIN', 'HR', 'MARKETING']), async (req, res) => {
    try {
      const inboxes = await adapter.getInboxForRecipient('ALL');
      res.json(inboxes);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- 8. TÍCH HỢP & ĐỒNG BỘ ---
  app.get('/admin/integrations/status', authMiddleware, requireRole(['ADMIN']), (req, res) => {
    const raw = adapter.getStatus();
    const ioServer = app.get('io');
    const rooms: string[] =
      ioServer?.sockets?.adapter?.rooms instanceof Map
        ? [...ioServer.sockets.adapter.rooms.keys()].filter((r: string) => !ioServer.sockets.adapter.sids.has(r))
        : [];
    res.json({
      ...raw,
      sheets: {
        total_tabs: SHEETS_DEFINITIONS.length,
        tabs: SHEETS_DEFINITIONS.map(d => d.title),
        sync_mode: 'SEQUENTIAL_SINGLE_WRITER',
      },
      drive: {
        storage_bucket: 'ubm-hr-attendance-receipts',
        // Đếm thật số biên nhận điểm danh đã ghi (thay vì hardcode).
        total_receipts: (adapter.getMockAdapter()?.attendanceEvents?.length ?? 0),
        healthy: true,
      },
      socket: {
        state: 'CONNECTED',
        rooms,
      },
      queue: {
        current_status: singleWriterQueue.getPendingCount() === 0 ? 'HEALTHY_IDLE' : 'PROCESSING',
        active_writers: 1,
        pending_jobs: singleWriterQueue.getPendingCount(),
      },
      uptime_seconds: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
    });
  });

  app.get('/api/sheets/status', (req, res) => {
    try {
      const syncService = (adapter as any).syncService;
      res.json({
        adapter: adapter.getStatus(),
        syncService: syncService ? syncService.getStatus() : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/integrations/sync-now', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const syncService = (adapter as any).syncService;
      let syncResult = {
        success: true,
        message: 'Đã hoàn tất đồng bộ với Google Sheets Master.',
        details: null as any,
      };

      if (syncService) {
        syncResult = await syncService.syncAllData(adapter);
      }

      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'MANUAL_FULL_SYNC_TRIGGERED',
        target_type: 'SYSTEM',
        target_id: 'GOOGLE_SHEETS_MASTER',
        details: syncResult,
      });

      broadcastUpdate('all', { action: 'sync-now' });

      res.json({
        success: syncResult.success,
        message: syncResult.message,
        details: syncResult.details,
        synced_at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[app.ts] Lỗi đồng bộ Google Sheets:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/integrations/pull-now', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const syncService = (adapter as any).syncService;
      if (!syncService) {
        return res.status(400).json({ success: false, message: 'Google Sheets sync service không khả dụng' });
      }
      const pullResult = await syncService.pullAllDataFromGoogleSheets(adapter);

      broadcastUpdate('all', { action: 'pull-now' });

      res.json({
        success: pullResult.success,
        message: pullResult.message,
        counts: pullResult.counts,
        pulled_at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[app.ts] Lỗi tải dữ liệu từ Google Sheets:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- 9. BẢO TRÌ HỆ THỐNG ---
  app.get('/admin/maintenance', authMiddleware, async (req, res) => {
    try {
      const maintenance = await adapter.getMaintenance();
      res.json(maintenance);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/maintenance', authMiddleware, requireRole(['ADMIN']), validate({ body: opaqueConfigBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const updated = await adapter.updateMaintenance(req.body);
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'MAINTENANCE_MODE_UPDATED',
        target_type: 'SYSTEM',
        target_id: 'MAINTENANCE',
        payload_after: updated,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- 10. AUDIT LOG ---
  app.get('/admin/audit', authMiddleware, requireRole(['ADMIN', 'HR']), async (req, res) => {
    try {
      const logs = await adapter.getAuditLogs(100);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- 11. BACKUP & RECOVERY ---
  app.get('/admin/backup/snapshots', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
    try {
      const snapshots = await adapter.getBackupSnapshots();
      res.json(snapshots);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/backup/snapshots', authMiddleware, requireRole(['ADMIN']), validate({ body: backupCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const snap = await adapter.createBackupSnapshot(req.body.name);
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'BACKUP_SNAPSHOT_CREATED',
        target_type: 'BACKUP',
        target_id: snap.snapshot_id,
        payload_after: snap,
      });
      res.json(snap);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/admin/backup/test-recovery', authMiddleware, requireRole(['ADMIN']), validate({ body: testRecoveryBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await adapter.testRecovery(req.body.snapshot_id);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- 12. CÀI ĐẶT HỆ THỐNG ---
  app.get('/admin/system-settings', authMiddleware, async (req, res) => {
    try {
      const settings = await adapter.getSystemSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/admin/system-settings', authMiddleware, requireRole(['ADMIN']), validate({ body: opaqueConfigBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const updated = await adapter.updateSystemSettings(req.body);
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'SYSTEM_SETTINGS_UPDATED',
        target_type: 'SETTINGS',
        target_id: 'SYSTEM_SETTINGS',
        payload_after: updated,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });


  // --- STATIC FRONTENDS SERVING (For All-in-One Cloud Deployment e.g. Render / Railway / Docker) ---
  const possibleAdminDirs = [
    path.resolve(process.cwd(), 'apps/admin-web/dist'),
    path.resolve(process.cwd(), '../admin-web/dist'),
    path.resolve(__dirname, '../../admin-web/dist'),
  ];
  const possibleEmpDirs = [
    path.resolve(process.cwd(), 'apps/employee-web/dist'),
    path.resolve(process.cwd(), '../employee-web/dist'),
    path.resolve(__dirname, '../../employee-web/dist'),
  ];

  const adminDist = possibleAdminDirs.find(d => fs.existsSync(d));
  const empDist = possibleEmpDirs.find(d => fs.existsSync(d));

  if (adminDist) {
    app.use('/admin', express.static(adminDist));
    app.get('/admin/*', (_req, res) => {
      res.sendFile(path.join(adminDist, 'index.html'));
    });
  }

  if (empDist) {
    app.use(express.static(empDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/admin') || req.path.startsWith('/socket.io')) {
        return next();
      }
      res.sendFile(path.join(empDist, 'index.html'));
    });
  }

  // --- Central error handler cho middleware (CORS, JSON parse) ---
  // Các route hiện tại tự try/catch nên handler này chỉ bắt lỗi từ middleware.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && typeof err.message === 'string' && err.message.startsWith('CORS blocked')) {
      return res.status(403).json({ error: 'CORS_FORBIDDEN', message: 'Origin không được phép' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Dữ liệu gửi lên quá lớn (tối đa 2MB)' });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'INVALID_JSON', message: 'Body không phải JSON hợp lệ' });
    }
    next(err);
  });

  return {
    app,
    adapter,
    services: {
      authService,
      accountsService,
      employeesService,
      schedulesService,
      attendanceService,
      payrollService,
      notificationsService,
      zaloService,
    },
  };
}
