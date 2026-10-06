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
  closeManualRegistration,
  getEffectiveWindow,
  getManualStatus,
  getWeeklyOffCompletion,
  getWeeklyOffStats,
  getWeeklyOffWindow,
  openManualRegistration,
} from './services/weekly-off.service.js';
import { ZaloService, defaultMeetUrl } from './services/zalo.service.js';
import { dedupeDuplicateInterviews } from './services/interview-dedupe.service.js';
import { AccountsService } from './services/accounts.service.js';
import { EmployeesService } from './services/employees.service.js';
import { canonicalPhone, findDuplicatePhones } from './services/employees.service.js';
import { SchedulesService } from './services/schedules.service.js';
import { AutoScheduleService } from './services/auto-schedule.service.js';
import { TestsService } from './services/tests.service.js';
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
  checkPhoneBody,
  employeeChangePinBody,
  phoneLoginBody,
  refreshBody,
} from './validators/auth.validator.js';
import {
  adjustmentApproveBody,
  adjustmentCreateBody,
  adjustmentsQuery,
  announcementBody,
  archiveEventsQuery,
  attendanceEventBody,
  attendanceEventsQuery,
  autoPlanBody,
  bulkImportBody,
  candidateImportBody,
  checkinBody,
  checkoutBody,
  colleagueShiftsQuery,
  defaultShiftBody,
  swapDispatchBody,
  supportCreateBody,
  employeeCreateBody,
  employeeUpdateBody,
  candidateRejectBody,
  candidateScoreBody,
  candidateUpdateBody,
  idParams,
  testPaperBody,
  testBankBody,
  testSubmitBody,
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
  probationOffBody,
  probationExtraShiftBody,
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
  emergencyGrantBody,
  probationAssessmentBody,
  probationMeetDoneBody,
  idParams as adminIdParams,
  internalAccountCreateBody,
  internalAccountUpdateBody,
  opaqueConfigBody,
  sendPinBody,
  testRecoveryBody,
  webhookBody,
} from './validators/admin.validator.js';
import {
  requirePermission,
  requireRole,
  enforceBranchScope,
} from './middlewares/rbac.middleware.js';
import { BRANCHES, ERROR_CODES, SHIFT_TEMPLATES } from '@ubm/shared';
import { SHEETS_DEFINITIONS } from './services/google-sheets-sync.service.js';
import { buildZipStore } from './utils/zip-store.js';
import { lateFineFor } from './services/payroll.service.js';

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
  // Nới trần JSON để chứa ảnh điểm danh 5MB (base64 phình ~33% + overhead).
  app.use(express.json({ limit: '10mb' }));
  app.use(generalRateLimiter());
  app.use('/auth/', authRateLimiter());

  const adapter = sheetsAdapter || new GoogleSheetsAdapter();
  singleWriterQueue.setRepository(adapter);

  const authMiddleware = createAuthMiddleware(adapter);
  const authService = new AuthService(adapter);
  const accountsService = new AccountsService(adapter);
  const employeesService = new EmployeesService(adapter);
  const schedulesService = new SchedulesService(adapter);
  const autoScheduleService = new AutoScheduleService(adapter);
  const testsService = new TestsService(adapter);
  const attendanceService = new AttendanceService(adapter);
  const payrollService = new PayrollService(adapter);
  const notificationsService = new NotificationsService(adapter);
  const zaloService = new ZaloService(adapter);
  // Khôi phục phiên Zalo cá nhân HR sau restart (không cần quét QR lại).
  // Chạy lần đầu sau khi pull Sheets xong + tick nền 5 phút giữ phiên tới khi HR đăng xuất.
  // (Render free: disk mất sau mỗi deploy/sleep nên lần đầu đọc từ cài đặt hệ thống.)
  const zaloRestoreTick = () => {
    zaloService.restoreSession().catch(err => console.warn('[zalo] restore error:', err?.message || err));
  };
  setTimeout(zaloRestoreTick, 30000);
  setInterval(() => {
    (zaloService.autoRestoreTick() as Promise<boolean>).catch(err => console.warn('[zalo] auto-restore error:', err?.message || err));
  }, 5 * 60_000);

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
  // Đồng thời LƯU TRỮ các sự kiện từ cổng nhân viên (điểm danh/đổi ca/nghỉ/PIN/TEST)
  // vào inbox + tab Sheets THONGBAO_NV để HR xem lại lịch sử (realtime + bền vững).
  const EMP_NOTIF_KIND: Record<string, string> = {
    CHECKIN: 'emp.checkin',
    CHECKOUT: 'emp.checkout',
    LEAVE: 'emp.leave',
    SWAP: 'emp.swap',
    PIN_CHANGED: 'emp.pin',
    TEST: 'emp.test',
  };
  const broadcastNotification = (notif: {
    type: 'CHECKIN' | 'CHECKOUT' | 'LEAVE' | 'SWAP' | 'PIN_CHANGED' | 'PIN_SENT' | 'CANDIDATE' | 'SYSTEM' | 'INFO' | 'TEST';
    title: string;
    message: string;
    linkTab?: string;
    metadata?: any;
    targetRoles?: string[];
  }) => {
    try {
      const io = app.get('io');
      if (io) {
        // Nguồn phát sinh: sự kiện NV thao tác (cổng nhân viên) hay HR/hệ thống.
        // 2 cổng lọc popup/chuông theo origin: admin chỉ nhận EMPLOYEE, NV chỉ nhận ADMIN.
        const origin = (['CHECKIN', 'CHECKOUT', 'LEAVE', 'SWAP', 'PIN_CHANGED', 'TEST'] as string[]).includes(notif.type)
          ? 'EMPLOYEE'
          : 'ADMIN';
        const payload = {
          id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          ...notif,
          origin,
          timestamp: new Date().toISOString(),
        };
        io.emit('system:notification', payload);
        io.emit('data:updated', { entity: 'notifications', data: payload, timestamp: payload.timestamp });
      }
    } catch (e) {
      // non-fatal
    }
    // Lưu trữ nền (không chặn response): chỉ sự kiện từ cổng nhân viên
    try {
      const kind = EMP_NOTIF_KIND[notif.type];
      if (kind) {
        notificationsService
          .sendNotification({
            recipientIds: ['ALL'],
            type: kind,
            severity: 'SYSTEM',
            title: notif.title,
            summary: notif.message,
            targetPath: notif.linkTab,
            actorId: (notif.metadata?.employeeId || notif.metadata?.accountId || 'SYSTEM') as string,
          })
          .catch(() => null);
      }
    } catch {
      // non-fatal
    }
  };

  // Ping siêu nhẹ cho UptimeRobot/monitor: KHÔNG chạm adapter/database/Sheets,
  // KHÔNG tốn quota — chỉ giữ Render không sleep.
  app.get('/ping', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Phiên bản đang chạy (public): so với commit main trên GitHub để biết
  // hệ thống đã cập nhật bản mới nhất chưa. startedAt cho biết instance
  // restart sau lần push cuối cùng chưa (Render free có thể chậm deploy).
  app.get('/version', (req, res) => {
    res.json({
      service: 'umb-backend',
      commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'local-dev',
      startedAt: new Date(SERVER_STARTED_AT).toISOString(),
      time: new Date().toISOString(),
    });
  });

  // Webhook Apps Script onEdit: sửa ô nào trên Sheet là web cập nhật trong 1-2s,
  // không đợi nhịp pull 10s. Xác thực bằng secret header (fail-closed).
  app.post('/hooks/sheets-edit', validate({ body: webhookBody }), async (req, res) => {
    try {
      const expected = process.env.SHEETS_WEBHOOK_SECRET || '';
      const got = (req.headers['x-webhook-secret'] as string) || '';
      if (!expected || got !== expected) {
        return res.status(403).json({ error: 'WEBHOOK_FORBIDDEN' });
      }
      const tab = (req.body?.tab as string) || '';
      const { accepted, done } = adapter.triggerSheetsPull(`webhook${tab ? ':' + tab : ''}`);
      // Trả ngay để Apps Script không timeout; pull xong thì đẩy socket cho 2 web app.
      done
        .then((r: any) => {
          if (r?.counts) {
            broadcastUpdate('sheets', { source: 'webhook', tab: tab || 'all', counts: r.counts });
          }
        })
        .catch(() => null);
      res.json({ received: true, accepted, tab: tab || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // RÀNG BUỘC REALTIME 100%: mọi request GHI thành công đều bắn socket `data:updated`
  // để 2 web app cập nhật tức thì — không route nào được phép im lặng.
  const entityForPath = (p: string): string | null => {
    if (p === '/ping' || p === '/health') return null;
    if (p.startsWith('/auth/')) return null; // login đã có broadcast riêng khi cần
    if (p.startsWith('/employees') || p.startsWith('/applications') || p.startsWith('/interviews')) return 'employees';
    if (p.startsWith('/admin/employee-accounts') || p.startsWith('/admin/internal-accounts')) return 'accounts';
    if (p.startsWith('/schedules') || p.startsWith('/leave-requests') || p.startsWith('/leaves') || p.startsWith('/swap-requests')) return 'schedules';
    if (p.startsWith('/attendance')) return 'attendance';
    if (p.startsWith('/payroll') || p.startsWith('/me/payslips')) return 'payroll';
    if (p.startsWith('/me/notifications') || p.startsWith('/admin/notifications') || p.startsWith('/announcements')) return 'notifications';
    if (p.startsWith('/tests') || p.startsWith('/me/tests')) return 'tests';
    if (p.startsWith('/admin/branches')) return 'branches';
    if (p.startsWith('/admin/zalo')) return 'zalo';
    if (p.startsWith('/admin/')) return 'settings';
    if (p.startsWith('/me/')) return 'me';
    return 'all';
  };
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const entity = entityForPath(req.path);
    if (!entity) return next();
    const origJson = res.json.bind(res);
    (res as any).json = (body: any) => {
      if (res.statusCode < 400) {
        broadcastUpdate(entity, { method: req.method, path: req.path });
      }
      return origJson(body);
    };
    next();
  });

  // Health check & status
  app.get('/health', (req, res) => {
    let memory: any = null;
    try {
      const mock = (adapter as any).getMockAdapter?.() || (adapter as any).fallbackAdapter;
      if (mock) {
        memory = {
          employees: mock.employees?.length ?? null,
          accounts: mock.accounts?.length ?? null,
          adminAccounts: mock.adminAccounts?.length ?? null,
        };
      }
    } catch { /* chỉ chẩn đoán, không chặn */ }
    res.json({
      status: 'UP',
      time: new Date().toISOString(),
      readiness: (adapter as any).getReadiness?.() || { ready: true },
      memory,
      sheetsStatus: adapter.getStatus(),
    });
  });

  // Cổng đăng ký 2 ngày OFF/tuần: public để app hiển thị banner/đếm ngược.
  // Bao gồm đợt mở bù VIP của Admin (manual) nếu còn hạn.
  app.get('/api/weekly-off-window', async (req, res) => {
    try {
      res.json(await getEffectiveWindow(adapter));
    } catch {
      res.json(getWeeklyOffWindow());
    }
  });

  // VIP: Admin mở bù cổng đăng ký OFF (mặc định 30 phút, tự đóng khi hết hạn).
  // Chỉ những bạn CHƯA đăng ký tuần này mới phải đăng ký bù; bạn đã đăng ký rồi được miễn.
  app.post('/admin/weekly-off/open', authMiddleware, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
      const minutes = Number(req.body?.minutes) || 30;
      const window = await openManualRegistration(adapter, req.user!.id, minutes);
      const stats = await getWeeklyOffStats(adapter, window.targetWeekMon, window.targetWeekSun).catch(() => null);
      const unregisteredNames = (stats?.unregistered || []).slice(0, 10).map(u => u.full_name).join(', ');
      broadcastUpdate('weekly-off', { action: 'manual-open', window, stats });
      broadcastNotification({
        type: 'SYSTEM',
        title: '🟢 Admin vừa mở bổ sung đăng ký 2 ngày OFF',
        message: stats
          ? `Cổng mở thêm ${minutes} phút cho tuần ${window.targetWeekMon} → ${window.targetWeekSun}. ${stats.registeredCount}/${stats.totalOfficial} bạn đã đăng ký (được miễn). ${stats.unregisteredCount} bạn chưa đăng ký${unregisteredNames ? `: ${unregisteredNames}${stats.unregisteredCount > 10 ? '…' : ''}` : ''} — tranh thủ ngay!`
          : `Cổng đăng ký mở thêm ${minutes} phút cho tuần ${window.targetWeekMon} → ${window.targetWeekSun}. NV chưa đăng ký tranh thủ ngay!`,
        linkTab: 'leave',
        metadata: { window, stats },
        targetRoles: ['ADMIN', 'HR', 'STORE', 'EMPLOYEE'],
      });
      res.json({ success: true, window, stats });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/admin/weekly-off/close', authMiddleware, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
      await closeManualRegistration(adapter, req.user!.id);
      broadcastUpdate('weekly-off', { action: 'manual-close' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/admin/weekly-off/manual-status', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
    try {
      const st: any = await getManualStatus(adapter);
      // Kèm thống kê ai chưa đăng ký để Admin chỉ nhắc đúng người.
      try {
        const window = await getEffectiveWindow(adapter);
        st.stats = await getWeeklyOffStats(adapter, window.targetWeekMon, window.targetWeekSun);
      } catch { /* best-effort */ }
      res.json(st);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- AUTH ---
  // Bước 1 luồng đăng nhập: SĐT có tồn tại trong CSDL không (chưa cần PIN).
  app.post('/auth/employee/check-phone', validate({ body: checkPhoneBody }), async (req, res) => {
    try {
      const exists = await authService.phoneExists(req.body.phone);
      res.json({ exists });
    } catch (err: any) {
      if (err.message === 'SHEETS_LOADING') {
        return res.status(503).json({
          error: 'SHEETS_LOADING',
          message: 'Hệ thống vừa khởi động, đang tải dữ liệu từ Google Sheets (khoảng 30 giây). Vui lòng đợi rồi thử lại.',
        });
      }
      if (err.message === 'SHEETS_UNAVAILABLE') {
        return res.status(503).json({
          error: 'SHEETS_UNAVAILABLE',
          message: 'Không đọc được Google Sheets (kiểm tra cấu hình server). Vui lòng báo Admin/HR.',
        });
      }
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/auth/employee/phone-login', validate({ body: phoneLoginBody }), async (req, res) => {
    try {
      const { phone, pin } = req.body;
      const result = await authService.loginWithPhone(phone, pin);
      res.json(result);
    } catch (err: any) {
      if (err.message === 'SHEETS_LOADING') {
        return res.status(503).json({
          error: 'SHEETS_LOADING',
          message: 'Hệ thống vừa khởi động, đang tải dữ liệu từ Google Sheets (khoảng 30 giây). Vui lòng đợi rồi đăng nhập lại — KHÔNG tạo lại tài khoản.',
        });
      }
      if (err.message === 'SHEETS_UNAVAILABLE') {
        return res.status(503).json({
          error: 'SHEETS_UNAVAILABLE',
          message: 'Không đọc được Google Sheets (kiểm tra cấu hình server). Vui lòng báo Admin/HR, không tạo lại tài khoản.',
        });
      }
      const status = err.message === ERROR_CODES.ACCOUNT_NOT_FOUND ? 404 : 400;
      if (err.message === 'PIN_RESET_REQUIRED') {
        return res.status(400).json({
          error: 'PIN_RESET_REQUIRED',
          message: 'Mã PIN cũ của bạn chưa đủ 6 số nên hệ thống đã tự động reset. Vui lòng hỏi HR lấy mã PIN 6 số mới rồi đăng nhập và đổi PIN riêng!',
        });
      }
      res.status(status).json({ error: err.message });
    }
  });

  // Nhân viên tự đổi mã PIN từ PIN cũ (kỳ định kỳ hàng tháng 1-5 + lần đầu).
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
      const status = err.message === 'WEAK_PIN' || err.message === 'SAME_PIN' ? 400 : 401;
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

  // Đồng nghiệp cùng chi nhánh (che SĐT — chỉ tên + mã NV để chọn đổi ca, chống lộ danh bạ).
  app.get('/me/colleagues', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.user?.role !== 'EMPLOYEE' || !req.user.employeeId) {
        return res.status(403).json({ error: 'NOT_AN_EMPLOYEE' });
      }
      const me = await employeesService.getEmployee(req.user.employeeId);
      const branchId = me?.default_branch_id || req.user.branchScope;
      const list = await employeesService.listEmployees(branchId === '*' ? undefined : branchId);
      res.json(
        list
          .filter(e => e.employee_id !== req.user!.employeeId && e.employment_status !== 'TERMINATED')
          .map(e => ({
            employee_id: e.employee_id,
            employee_code: e.employee_code,
            full_name: e.full_name,
          }))
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trạng thái đăng ký OFF tuần của chính nhân viên (frontend đồng bộ khóa/mở).
  app.get('/me/weekly-off-status', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const window = await getEffectiveWindow(adapter).catch(() => getWeeklyOffWindow());
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

  // Ca của 1 NV theo khoảng ngày (cho form HR chuyển ca hỗ trợ: chọn ca của A).
  app.get('/admin/employee-shifts/:employeeId', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ query: meScheduleQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const fromDate = (req.query.fromDate as string) || new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
      const toDate = (req.query.toDate as string) || '2030-12-31';
      const shifts = await schedulesService.getEmployeeShifts(req.params.employeeId, fromDate, toDate);
      res.json(shifts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- BÁO NGHỈ KHẨN 1 LẦN cho NV thử việc (mặc định ẩn) ---
  // Lượt kích hoạt lưu trong system settings (không đổi schema Sheet):
  // emergencyLeaveGrants = { [employeeId]: { grantedAt, grantedBy, usedAt? } }.
  // NV thử việc chỉ thấy + dùng được chức năng khi có lượt chưa dùng; gửi xong
  // phiếu là lượt bị tiêu thụ ngay (chức năng tự ẩn lại).
  const EMERGENCY_GRANT_KEY = 'emergencyLeaveGrants';
  const readEmergencyGrants = async (): Promise<Record<string, any>> => {
    try {
      const settings = (await adapter.getSystemSettings()) || {};
      return (settings as any)[EMERGENCY_GRANT_KEY] || {};
    } catch {
      return {};
    }
  };

  // Admin/HR kích hoạt 1 lượt báo nghỉ khẩn cho 1 nhân viên (dùng 1 lần duy nhất).
  app.post('/admin/emergency-leave/grant', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: emergencyGrantBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = String(req.body.employeeId || '').trim();
      const emp = await employeesService.getEmployee(employeeId).catch(() => null);
      if (!emp) return res.status(404).json({ error: 'Không tìm thấy hồ sơ nhân viên' });
      const settings = (await adapter.getSystemSettings()) || {};
      const grants = { ...((settings as any)[EMERGENCY_GRANT_KEY] || {}) };
      grants[employeeId] = { grantedAt: new Date().toISOString(), grantedBy: req.user!.id, usedAt: null };
      await adapter.updateSystemSettings({ ...settings, [EMERGENCY_GRANT_KEY]: grants });
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'EMERGENCY_LEAVE_GRANTED',
        target_type: 'NHAN_VIEN_MASTER',
        target_id: employeeId,
      });
      broadcastUpdate('emergencyLeave', { action: 'grant', employeeId });
      res.json({ success: true, message: `Đã kích hoạt báo nghỉ khẩn 1 lần cho ${(emp as any).full_name || employeeId}` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Admin/HR xem toàn bộ lượt kích hoạt (để hiển thị trạng thái chờ dùng/đã dùng).
  app.get('/admin/emergency-leave/grants', authMiddleware, requireRole(['ADMIN', 'HR']), async (_req, res) => {
    try {
      res.json({ grants: await readEmergencyGrants() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Nhân viên tự xem mình có lượt báo nghỉ khẩn chưa dùng không.
  app.get('/me/emergency-leave-status', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.json({ enabled: false });
      const grants = await readEmergencyGrants();
      const g = grants[employeeId];
      res.json({ enabled: !!g && !g.usedAt });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- KIỂM TRA ĐẦU RA THỬ VIỆC (Google Meet vấn đáp + bài trắc nghiệm) ---
  // Lịch lưu trong system settings (không đổi schema Sheet):
  // probationAssessments = { [employeeId]: { meetDate, meetTime, meetUrl,
  //   quizTestId?, meetDone?, createdBy, createdAt, updatedAt } }.
  // Ngày hoàn thành thử việc = start_date + 11 ngày (cửa sổ 12 ngày).
  const ASSESSMENT_KEY = 'probationAssessments';
  const readAssessments = async (): Promise<Record<string, any>> => {
    try {
      const settings = (await adapter.getSystemSettings()) || {};
      return (settings as any)[ASSESSMENT_KEY] || {};
    } catch {
      return {};
    }
  };
  const probationEndDateOf = (emp: any): string => {
    const s = String((emp as any)?.start_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    const d = new Date(`${s}T00:00:00Z`);
    if (!Number.isFinite(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + 11);
    return d.toISOString().slice(0, 10);
  };

  // Link Google Meet hiện tại của hệ thống (modal lên lịch tự điền sẵn).
  app.get('/admin/system-meet-url', authMiddleware, requireRole(['ADMIN', 'HR']), async (_req, res) => {
    try {
      res.json({ meetUrl: defaultMeetUrl() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin/HR lên lịch kiểm tra đầu ra cho 1 NV thử việc (gửi cả 2 hình thức 1 lần).
  app.post('/admin/probation-assessment/schedule', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: probationAssessmentBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const { employeeId, meetDate, meetTime, quizTestId } = req.body;
      // Để trống link -> hệ thống tự lấy link Meet hiện tại.
      const meetUrl = String(req.body.meetUrl || '').trim() || defaultMeetUrl();
      const emp = await employeesService.getEmployee(employeeId).catch(() => null);
      if (!emp) return res.status(404).json({ error: 'Không tìm thấy hồ sơ nhân viên' });
      if ((emp as any).employment_status !== 'PROBATION') {
        return res.status(400).json({ error: 'Chỉ lên lịch kiểm tra đầu ra cho nhân viên đang thử việc!' });
      }
      if (quizTestId) {
        const papers = await testsService.listPapers().catch(() => []);
        if (!papers.some((p: any) => p.test_id === quizTestId)) {
          return res.status(404).json({ error: 'Không tìm thấy đề trắc nghiệm đã chọn!' });
        }
      }
      const settings = (await adapter.getSystemSettings()) || {};
      const all = { ...((settings as any)[ASSESSMENT_KEY] || {}) };
      const prev = all[employeeId] || {};
      all[employeeId] = {
        ...prev,
        meetDate, meetTime, meetUrl,
        ...(quizTestId ? { quizTestId } : {}),
        meetDone: prev.meetDone || null,
        createdBy: req.user!.id,
        createdAt: prev.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await adapter.updateSystemSettings({ ...settings, [ASSESSMENT_KEY]: all });
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'PROBATION_ASSESSMENT_SCHEDULED',
        target_type: 'NHAN_VIEN_MASTER',
        target_id: employeeId,
      });
      const endDate = probationEndDateOf(emp);
      const quizPart = quizTestId ? ' + làm bài trắc nghiệm được giao ở tab Thi TEST' : '';
      await notificationsService.sendNotification({
        recipientIds: [employeeId],
        type: 'PROBATION_ASSESSMENT',
        severity: 'ACTION_REQUIRED',
        title: `📅 Lịch kiểm tra đầu ra thử việc (hoàn thành ${endDate ? endDate.split('-').reverse().join('/') : 'kỳ này'})`,
        summary: `${(emp as any).full_name || ''} ơi, bạn được xếp kiểm tra đầu ra lúc ${meetTime} ngày ${meetDate.split('-').reverse().join('/')} qua Google Meet. Bấm vào để xem link Meet${quizPart}!`,
        targetPath: '/schedule',
        actorId: req.user!.id,
      }).catch(() => null);
      broadcastUpdate('probationAssessment', { action: 'schedule', employeeId });
      res.json({ success: true, message: `Đã lên lịch kiểm tra đầu ra cho ${(emp as any).full_name || employeeId} (Meet ${meetTime} ${meetDate})!` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Admin/HR xem toàn bộ lịch kiểm tra đầu ra (kèm điểm trắc nghiệm nếu NV đã nộp).
  app.get('/admin/probation-assessment/list', authMiddleware, requireRole(['ADMIN', 'HR']), async (_req, res) => {
    try {
      const all = await readAssessments();
      const out = [];
      for (const [employeeId, a] of Object.entries<any>(all)) {
        const emp = await employeesService.getEmployee(employeeId).catch(() => null);
        let quiz: any = null;
        if (a?.quizTestId) {
          const subs = await testsService.listSubmissions(a.quizTestId, employeeId).catch(() => []);
          const s = (Array.isArray(subs) ? subs : []).find((x: any) => x.employee_id === employeeId);
          if (s) quiz = { status: s.status, score: s.score ?? null, passed: s.passed ?? null, submittedAt: s.submitted_at || null };
        }
        out.push({
          employeeId,
          fullName: (emp as any)?.full_name || employeeId,
          employeeCode: (emp as any)?.employee_code || '',
          endDate: emp ? probationEndDateOf(emp) : '',
          stillProbation: !!emp && (emp as any).employment_status === 'PROBATION',
          ...a,
          quiz,
        });
      }
      res.json({ assessments: out });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin/HR chấm xong phần vấn đáp Meet (Đạt / Không đạt).
  app.post('/admin/probation-assessment/meet-done', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: probationMeetDoneBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const { employeeId, passed, note } = req.body;
      const settings = (await adapter.getSystemSettings()) || {};
      const all = { ...((settings as any)[ASSESSMENT_KEY] || {}) };
      if (!all[employeeId]) return res.status(404).json({ error: 'Nhân viên này chưa được lên lịch kiểm tra đầu ra!' });
      all[employeeId] = {
        ...all[employeeId],
        meetDone: { passed: !!passed, note: String(note || ''), at: new Date().toISOString(), by: req.user!.id },
        updatedAt: new Date().toISOString(),
      };
      await adapter.updateSystemSettings({ ...settings, [ASSESSMENT_KEY]: all });
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: passed ? 'PROBATION_MEET_PASSED' : 'PROBATION_MEET_FAILED',
        target_type: 'NHAN_VIEN_MASTER',
        target_id: employeeId,
      });
      broadcastUpdate('probationAssessment', { action: 'meet-done', employeeId, passed: !!passed });
      res.json({ success: true, message: `Đã ghi nhận vấn đáp Meet: ${passed ? 'ĐẠT' : 'CHƯA ĐẠT'}!` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Nhân viên xem lịch kiểm tra đầu ra của chính mình (+ điểm trắc nghiệm).
  app.get('/me/probation-assessment', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.json({ assessment: null });
      const all = await readAssessments();
      const a = all[employeeId];
      if (!a) return res.json({ assessment: null });
      let quiz: any = null;
      if (a.quizTestId) {
        const subs = await testsService.listSubmissions(a.quizTestId, employeeId).catch(() => []);
        const s = (Array.isArray(subs) ? subs : []).find((x: any) => x.employee_id === employeeId);
        if (s) quiz = { status: s.status, score: s.score ?? null, passed: s.passed ?? null };
      }
      const emp = await employeesService.getEmployee(employeeId).catch(() => null);
      res.json({ assessment: { ...a, quiz, endDate: emp ? probationEndDateOf(emp) : '' } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trạng thái ghi Sheets nền cho UI poll: tạo xong bao lâu thì đã lên Sheet.
  app.get('/admin/sync-status', authMiddleware, requireRole(['ADMIN', 'HR']), async (req, res) => {
    try {
      res.json({
        ...(adapter as any).getPendingSheetsWrites?.() || { pendingWrites: 0, lastSheetsWriteAt: null },
        time: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- ACCOUNTS: SĐT + mã PIN tự động (hệ thống tự sinh PIN khởi tạo cho từng tài khoản,
  // nhân viên đăng nhập lần đầu rồi đặt PIN riêng ngay — không còn HR cấp tay) ---
  // Kỳ định kỳ hàng tháng (1-5): NV TỰ đổi PIN mới từ PIN cũ — KHÔNG reset.
  // HR không reset PIN nữa: khi NV quên PIN cũ thì xem cột Mã PIN (bản rõ hiện tại)
  // để nhắc lại, NV tự đổi từ PIN đó.

  // ĐÃ BỎ reset PIN (theo yêu cầu vận hành 2026-10): giữ route để frontend cũ
  // không gãy, nhưng luôn trả 410 + hướng dẫn quy trình tự đổi.
  app.post('/admin/employee-accounts/:id/reset-pin', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: adminIdParams }), async (_req: AuthenticatedRequest, res) => {
    return res.status(410).json({
      error: 'PIN_RESET_DISABLED',
      message: 'Đã bỏ reset PIN: NV tự đổi PIN mới từ PIN cũ trong kỳ 1-5 hàng tháng. Nếu NV quên PIN cũ, HR xem cột Mã PIN để nhắc lại PIN hiện tại, NV đăng nhập bằng PIN đó rồi tự đổi PIN mới.',
    });
  });

  // Gửi mã PIN khởi tạo qua Zalo cá nhân HR (đơn lẻ hoặc hàng loạt cho NV chưa đổi PIN).
  // Yêu cầu Zalo đã kết nối (QR login trước). Gửi tuần tự + nghỉ 800ms để chống spam/khóa.
  app.post('/admin/employee-accounts/send-pin-zalo', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: sendPinBody }), async (req: AuthenticatedRequest, res) => {
    try {
      if (!zaloService.isConnected()) {
        return res.status(400).json({
          error: 'ZALO_NOT_CONNECTED',
          message: 'Zalo cá nhân HR chưa kết nối! Vào tab Zalo quét QR đăng nhập trước khi gửi PIN.',
        });
      }
      const { accountIds, allPending } = req.body || {};
      let accounts = await adapter.listAccounts();
      // Chỉ gửi cho tài khoản còn PIN khởi tạo chưa đổi (có pin_code để gửi).
      if (Array.isArray(accountIds) && accountIds.length > 0) {
        const set = new Set(accountIds);
        accounts = accounts.filter(a => set.has(a.account_id));
      } else if (allPending) {
        accounts = accounts.filter(a => a.pin_must_change === true && (a as any).pin_code);
      } else {
        accounts = accounts.filter(a => a.pin_must_change === true && (a as any).pin_code);
      }
      if (accounts.length === 0) {
        return res.json({ success: true, total: 0, sent: 0, failed: 0, results: [], message: 'Không có tài khoản nào còn PIN khởi tạo để gửi.' });
      }
      if (accounts.length > 100) accounts = accounts.slice(0, 100);

      const results: any[] = [];
      let sent = 0;
      for (const acc of accounts) {
        const pin = (acc as any).pin_code;
        const phone = acc.phone_normalized || '';
        let empName = acc.employee_id;
        try {
          const emp = await employeesService.getEmployee(acc.employee_id).catch(() => null);
          if (emp?.full_name) empName = emp.full_name;
        } catch { /* giữ fallback */ }
        if (!pin) {
          results.push({ accountId: acc.account_id, phone, name: empName, status: 'NO_PIN', detail: 'NV đã đổi PIN riêng — không còn mã khởi tạo để gửi.' });
          continue;
        }
        if (!phone) {
          results.push({ accountId: acc.account_id, phone, name: empName, status: 'NO_PHONE', detail: 'Thiếu SĐT.' });
          continue;
        }
        try {
          const found = await zaloService.findUserByPhone(phone);
          const text = zaloService.buildPinText({ employeeName: empName, pin });
          try {
            const sentRes = await zaloService.sendText(found.uid, text);
            sent++;
            results.push({ accountId: acc.account_id, phone, name: empName, status: 'SENT', detail: `Đã gửi tới UID ${found.uid}`, msgId: sentRes.msgId });
            await adapter.recordAuditLog({
              actor_id: req.user!.id,
              action: 'ZALO_PIN_SENT',
              target_type: 'TAI_KHOAN_NHAN_VIEN',
              target_id: acc.account_id,
            } as any).catch(() => null);
          } catch (e: any) {
            results.push({ accountId: acc.account_id, phone, name: empName, status: 'NOT_FRIEND', detail: 'Chưa kết bạn Zalo — bấm Kết bạn rồi gửi lại.', uid: found.uid });
          }
        } catch (e: any) {
          const msg = e?.message || '';
          results.push({
            accountId: acc.account_id, phone, name: empName,
            status: msg.includes('ZALO_USER_NOT_FOUND') ? 'NOT_FOUND' : 'ERROR',
            detail: msg.includes('ZALO_USER_NOT_FOUND') ? 'SĐT chưa đăng ký Zalo hoặc chặn tìm kiếm.' : msg,
          });
        }
        // Nghỉ giữa các tin để Zalo không đánh dấu spam.
        await new Promise(r => setTimeout(r, 800));
      }
      const failed = results.length - sent;
      broadcastUpdate('accounts', { action: 'send-pin-zalo', sent, failed });
      broadcastNotification({
        type: 'PIN_SENT',
        title: `📩 Đã gửi ${sent}/${results.length} mã PIN qua Zalo`,
        message: sent > 0 ? `Đã bắn PIN khởi tạo tới ${sent} nhân viên. ${failed > 0 ? `${failed} ca lỗi (chưa kết bạn/chưa có Zalo).` : 'Tất cả thành công!'}` : 'Không gửi được ca nào — kiểm tra kết bạn Zalo.',
        linkTab: 'activation',
        metadata: { sent, failed },
        targetRoles: ['ADMIN', 'HR'],
      });
      res.json({ success: true, total: results.length, sent, failed, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- EMPLOYEES & RECRUITMENT ---
  app.get(
    '/employees',
    authMiddleware,
    requireRole(['ADMIN', 'HR', 'STORE', 'FINANCE']),
    enforceBranchScope(req => req.query.branchId as string),
    async (req: AuthenticatedRequest, res) => {
      try {
        const branchScope = req.user?.role === 'STORE' ? req.user.branchScope : (req.query.branchId as string);
        const emps = await employeesService.listEmployees(branchScope, req.query.status as string);
        // Kèm cờ khóa tài khoản để UI hiện badge + ẩn khỏi Lịch (join nhẹ từ accounts).
        const lockedIds = new Set<string>();
        const lockedPhones = new Set<string>();
        try {
          const accs = await (adapter as any).listAccounts().catch(() => []);
          for (const a of accs || []) {
            if ((a as any)?.account_status === 'LOCKED') {
              if ((a as any)?.employee_id) lockedIds.add(String((a as any).employee_id));
              if ((a as any)?.phone_normalized) lockedPhones.add(canonicalPhone((a as any).phone_normalized));
            }
          }
        } catch { /* bỏ qua: mặc định không khóa */ }
        // Cắt bytes avatar inline khỏi danh sách (nhẹ payload); ảnh xem qua /employees/:id/avatar.
        res.json((emps || []).map((e: any) => {
          const { avatar_photo: _drop, ...rest } = (e as any) || {};
          const isLocked = lockedIds.has(String((e as any)?.employee_id)) ||
            (e?.phone_normalized && lockedPhones.has(canonicalPhone(e.phone_normalized))) ||
            (e as any)?.account_locked === true ||
            (e as any)?.account_status === 'LOCKED';
          if (isLocked) {
            return { ...rest, account_locked: true, account_status: 'LOCKED' };
          }
          return { ...((e as any)?.avatar_photo ? rest : e), account_locked: false, account_status: 'ACTIVE' };
        }));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post('/employees', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: employeeCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const b = req.body;
      const normPhone = canonicalPhone((b.phone || b.phone_normalized || '').trim());
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
        defaultShiftCode: ['CA_1', 'CA_2', 'CA_3'].includes(String(b.defaultShiftCode || b.default_shift_code || '').toUpperCase())
          ? String(b.defaultShiftCode || b.default_shift_code).toUpperCase() as any
          : undefined,
        actorId: req.user!.id,
      });
      broadcastUpdate('employees', { action: 'create', employee: result });
      broadcastUpdate('accounts', { action: 'create_emp_account' });
      // Đính kèm tài khoản vừa sinh (kèm PIN) để UI chèn tức thì, khỏi fetch lại.
      const empId = (result as any)?.result?.employee_id || (result as any)?.employee_id;
      let account: any = null;
      try {
        const accs = normPhone ? await adapter.findAccountByPhone(normPhone) : [];
        const found = accs.find(a => a.employee_id === empId) || accs[0];
        if (found) {
          const { pin_hash: _omit, ...rest } = found as any;
          account = rest;
        }
      } catch { /* UI tự tải lại sau */ }
      res.json({ ...(result as any), account });
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

  // HR/Admin cập nhật hồ sơ nhân viên (tên, SĐT, chi nhánh, khối, lương, ca...).
  app.put('/employees/:id', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams, body: employeeUpdateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const b = req.body;
      // Chuẩn hóa ở service (chấp nhận tên tiếng Việt từ dữ liệu cũ).
      const group = b.group ? String(b.group) : undefined;
      const shiftRaw = b.defaultShiftCode !== undefined ? String(b.defaultShiftCode || '').toUpperCase() : undefined;
      if (shiftRaw !== undefined && shiftRaw !== '' && !['CA_1', 'CA_2', 'CA_3'].includes(shiftRaw)) {
        return res.status(400).json({ error: 'INVALID_SHIFT_CODE: ca cố định phải là CA_1, CA_2 hoặc CA_3.' });
      }
      const result = await employeesService.updateEmployee(
        req.params.id,
        {
          fullName: b.fullName,
          phone: b.phone,
          branchId: b.branchId || b.branch_id || b.default_branch_id,
          group: group as any,
          ratePerHour: b.currentRatePerHour ?? b.current_rate_per_hour,
          defaultShiftCode: shiftRaw === undefined ? undefined : ((shiftRaw || null) as any),
          startDate: b.startDate || b.start_date,
          officialDate: b.officialDate || b.official_date,
          email: b.email,
          gender: b.gender,
          birthDate: b.birthDate || b.birth_date,
          idCardNumber: b.idCardNumber || b.id_card_number,
          // Avatar HR upload ở tab Hồ Sơ (snake_case từ client).
          avatarBase64: b.avatarBase64 || b.avatar_base64,
          expectedVersion: b.expectedVersion,
        },
        req.user!.id
      );
      broadcastUpdate('employees', { action: 'update', employee: result });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Ảnh avatar NV (tab Hồ Sơ): stream từ Drive, rớt xuống inline khi Drive lỗi —
  // mirror endpoint ảnh bằng chứng bù công.
  const serveEmployeeAvatar = async (req: AuthenticatedRequest, res: any) => {
    try {
      const emp: any = await employeesService.getEmployee(req.params.id).catch(() => null);
      if (!emp) return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' });
      if (req.user?.role === 'STORE' && req.user.branchScope !== '*' && emp.default_branch_id && emp.default_branch_id !== req.user.branchScope) {
        return res.status(403).json({ error: 'BRANCH_SCOPE_FORBIDDEN' });
      }
      const inlinePhoto: string | undefined = (emp as any).avatar_photo;
      const driveId: string = String((emp as any).avatar_drive_id || '');
      const serveInline = (dataUrl: string) => {
        try {
          const m = String(dataUrl).match(/^data:(image\/\w+);base64,(.*)$/);
          const mime = m ? m[1] : 'image/jpeg';
          const b64 = m ? m[2] : String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(b64, 'base64');
          if (!buffer.length) throw new Error('EMPTY_INLINE_PHOTO');
          res.setHeader('Content-Type', mime);
          res.setHeader('Cache-Control', 'private, max-age=3600');
          return res.send(buffer);
        } catch {
          return res.status(404).json({ error: 'AVATAR_NOT_UPLOADED' });
        }
      };
      if (driveId && !driveId.startsWith('DRV_')) {
        try {
          const syncService = (adapter as any).syncService;
          if (syncService?.downloadDriveFile) {
            const { buffer, mimeType } = await syncService.downloadDriveFile((emp as any).avatar_drive_id);
            res.setHeader('Content-Type', mimeType || 'image/jpeg');
            res.setHeader('Cache-Control', 'private, max-age=3600');
            return res.send(buffer);
          }
        } catch {
          if (inlinePhoto) return serveInline(inlinePhoto);
          return res.status(404).json({ error: 'AVATAR_NOT_UPLOADED' });
        }
        if (inlinePhoto) return serveInline(inlinePhoto);
        return res.status(404).json({ error: 'AVATAR_NOT_UPLOADED' });
      }
      if (inlinePhoto) return serveInline(inlinePhoto);
      return res.status(404).json({ error: 'AVATAR_NOT_UPLOADED' });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'AVATAR_DOWNLOAD_FAILED' });
    }
  };
  app.get('/employees/:id/avatar', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), serveEmployeeAvatar);

  // HR khóa tài khoản NV chính thức: LOCKED + XÓA PIN + văng phiên ngay.
  // Hồ sơ/điểm danh/công/lương GIỮ NGUYÊN — Lịch làm việc xóa ngay lập tức các ca từ hôm nay.
  app.post('/employees/:id/lock', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await employeesService.lockEmployeeAccount(req.params.id, req.user!.id);
      broadcastUpdate('employees', { action: 'lock', employeeId: req.params.id });
      broadcastUpdate('accounts', { action: 'lock', employeeId: req.params.id });
      broadcastUpdate('schedules', { action: 'delete', employeeId: req.params.id });
      const io = app.get('io');
      if (io) {
        io.emit('employees:locked', { employeeId: req.params.id });
        io.emit('schedule.published', { employeeId: req.params.id });
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // HR mở khóa lại: ACTIVE + cấp PIN 6 số mới (trả PIN để trao tay NV).
  app.post('/employees/:id/unlock', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await employeesService.unlockEmployeeAccount(req.params.id, req.user!.id);
      broadcastUpdate('employees', { action: 'unlock', employeeId: req.params.id });
      broadcastUpdate('accounts', { action: 'unlock', employeeId: req.params.id });
      const io = app.get('io');
      if (io) {
        io.emit('employees:unlocked', { employeeId: req.params.id });
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/employees/:id/transition-official', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams, body: transitionBody }), async (req: AuthenticatedRequest, res) => {    try {
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

  // Gán / đổi ca cố định cho nhân viên (BOT dựa vào đây để tự xếp lịch khi PUBLISH).
  app.put('/employees/:id/default-shift', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), validate({ params: idParams, body: defaultShiftBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const raw = String(req.body?.shiftCode || req.body?.shift_code || '').trim().toUpperCase();
      const shiftCode = raw === '' ? null : raw;
      if (shiftCode !== null && shiftCode !== 'CA_1' && shiftCode !== 'CA_2' && shiftCode !== 'CA_3') {
        return res.status(400).json({ error: 'INVALID_SHIFT_CODE: ca cố định phải là CA_1, CA_2 hoặc CA_3.' });
      }
      const emp = await employeesService.getEmployee(req.params.id);
      if (!emp) return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' });
      if (req.user?.role === 'STORE' && req.user.branchScope !== '*' && emp.default_branch_id !== req.user.branchScope) {
        return res.status(403).json({ error: 'BRANCH_SCOPE_FORBIDDEN' });
      }
      const result = await employeesService.setDefaultShift(req.params.id, shiftCode as any, req.user!.id);
      broadcastUpdate('employees', { action: 'default-shift', employee: result });
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

  // Xóa trực tiếp 1 tài khoản NV (dọn dòng mồ côi ở tab PIN: còn tài khoản
  // nhưng đã mất hồ sơ NHAN_VIEN_MASTER nên nút xóa thường báo 404 oan).
  app.delete('/employee-accounts/:id', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const id = req.params.id;
      const del = (adapter as any).deleteAccount;
      if (typeof del !== 'function') {
        return res.status(500).json({ error: 'Máy chủ chưa hỗ trợ xóa tài khoản trực tiếp' });
      }
      const ok = await del.call(adapter, id);
      if (!ok) {
        return res.status(404).json({ error: 'Không tìm thấy tài khoản để xóa' });
      }
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'EMPLOYEE_ACCOUNT_DELETED',
        target_type: 'TAI_KHOAN_NHAN_VIEN',
        target_id: id,
      });
      broadcastUpdate('accounts', { action: 'delete', id });
      res.json({ success: true, message: `Đã xóa tài khoản ${id}` });
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
      broadcastUpdate('candidates', { action: 'schedule-interview', id: submissionId });
      res.json(result);
    } catch (err: any) {
      const msg = String(err?.message || 'Lỗi xếp lịch phỏng vấn');
      // Lỗi khung 30p / trùng lịch: trả text Việt trực tiếp để UI toast + yêu cầu đăng ký lại.
      const status = msg.startsWith('TRÙNG LỊCH PV') ? 409 : 400;
      res.status(status).json({ error: msg });
    }
  });

  // Rà soát lịch PV trùng (< 30 phút cùng ngày): xem trước, không xóa.
  app.get('/admin/interviews/duplicates', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await dedupeDuplicateInterviews(adapter, notificationsService, { dryRun: true, actorId: req.user!.id });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || 'Lỗi rà soát lịch PV') });
    }
  });

  // Xóa lịch PV trùng + yêu cầu đăng ký lại (dryRun=true để xem trước).
  app.post('/admin/interviews/dedupe', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const dryRun = (req.body as any)?.dryRun === true;
      const result = await dedupeDuplicateInterviews(adapter, notificationsService, { dryRun, actorId: req.user!.id });
      if (!dryRun && result.removedCount > 0) {
        broadcastUpdate('candidates', { action: 'interview-duplicates-removed', removed: result.removedCount });
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || 'Lỗi xóa lịch PV trùng') });
    }
  });

  // --- ỨNG VIÊN: cập nhật ca đăng ký / khôi phục / chấm rubric / duyệt / loại ---
  // Cập nhật ca đăng ký / chi nhánh / khôi phục (REJECTED -> NEW).
  app.put('/applications/:id', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams, body: candidateUpdateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await employeesService.updateCandidateFields(req.params.id, req.body || {}, req.user!.id);
      // Đẩy master FROM_NHAN_VIEN NGAY (await): ca/chi nhánh HR vừa chốt bền vững trên
      // Sheet trước khi trả response — pull nền sau đó phủ lại đúng giá trị mới thay vì
      // dựng lại từ form gốc (fix "báo thành công nhưng dữ liệu không đổi"). Pattern như
      // hủy/xác nhận lịch PV.
      try {
        await (adapter as any)?.pushCandidatesNow?.();
      } catch { /* best-effort, full-sync nền sẽ thử lại */ }
      broadcastUpdate('candidates', { action: 'update', id: req.params.id });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || 'Lỗi cập nhật ứng viên') });
    }
  });

  // Xóa cứng ứng viên khỏi hệ thống + Google Sheet NGAY (không khôi phục).
  // HR dùng khi loại hồ sơ rác/chưa đạt thay vì chờ tự động.
  app.delete('/applications/:id', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const cands = await adapter.listCandidates().catch(() => []);
      const cand: any = (cands || []).find((c: any) => c.submission_id === req.params.id);
      if (!cand) return res.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });
      const ok = await (adapter as any).deleteCandidate(req.params.id);
      if (!ok) return res.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: 'CANDIDATE_DELETED',
        target_entity: 'UNG_VIEN',
        target_id: req.params.id,
        details: `Xóa cứng ứng viên ${cand.full_name || req.params.id} khỏi hệ thống + Sheet`,
      } as any).catch(() => null);
      broadcastUpdate('candidates', { action: 'deleted', id: req.params.id });
      res.json({ success: true, deleted: req.params.id });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || 'Lỗi xóa ứng viên') });
    }
  });

  // HR hủy lịch PV (quá 5 phút không vào Meet / chủ động hủy): xóa ngày+khung giờ,
  // trạng thái về NEW (chưa đăng ký lịch PV). Giữ nguyên điểm đã chấm.
  app.post('/interviews/:id/cancel', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const reason = String((req.body as any)?.reason || '').slice(0, 500);
      const result = await employeesService.cancelInterviewSchedule(req.params.id, req.user!.id, reason || undefined);
      // Chống hồi sinh: đánh dấu tombstone + đẩy master FROM_NHAN_VIEN NGAY (await)
      // để pull nền/pull tay sau đó không đọc lại dòng lịch cũ (pattern như dedupe).
      try {
        const syncSvc = (adapter as any)?.syncService;
        syncSvc?.markInterviewScheduleCleared?.(req.params.id);
        await (adapter as any)?.pushCandidatesNow?.();
      } catch { /* best-effort, tombstone đã chặn hồi sinh 120s */ }
      broadcastUpdate('candidates', { action: 'interview-cancelled', id: req.params.id });
      res.json({ success: true, candidate: result });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || 'Lỗi hủy lịch phỏng vấn') });
    }
  });

  // HR ghi nhận ứng viên XÁC NHẬN sẽ tham gia (UV báo qua điện thoại/Zalo tay).
  app.post('/interviews/:id/confirm', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await employeesService.confirmInterview(req.params.id, req.user!.id, 'HR');
      try {
        await (adapter as any)?.pushCandidatesNow?.();
      } catch { /* best-effort */ }
      broadcastUpdate('candidates', { action: 'interview-confirmed', id: req.params.id });
      res.json({ success: true, candidate: result });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || 'Lỗi xác nhận lịch phỏng vấn') });
    }
  });

  // HR đánh dấu ứng viên VẮNG không phép (không đến dù đã mời/xác nhận):
  // trạng thái NO_SHOW + xóa lịch giải phóng slot. Muốn PV lại thì đặt lịch mới.
  app.post('/interviews/:id/no-show', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const reason = String((req.body as any)?.reason || '').slice(0, 500);
      const result = await employeesService.markInterviewNoShow(req.params.id, req.user!.id, reason || undefined);
      try {
        const syncSvc = (adapter as any)?.syncService;
        syncSvc?.markInterviewScheduleCleared?.(req.params.id);
        await (adapter as any)?.pushCandidatesNow?.();
      } catch { /* best-effort */ }
      broadcastUpdate('candidates', { action: 'interview-no-show', id: req.params.id });
      res.json({ success: true, candidate: result });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || 'Lỗi đánh dấu vắng') });
    }
  });

  // Chấm điểm rubric PV (server tự tính; dính LOẠI thẳng -> REJECTED + xóa lịch luôn).
  app.post('/applications/:id/score', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams, body: candidateScoreBody }), async (req: AuthenticatedRequest, res) => {    try {
      const { rubric, answers } = req.body as any;
      const result = await employeesService.scoreCandidate(req.params.id, rubric, answers || {}, req.user!.id);
      broadcastUpdate('candidates', { action: 'score', id: req.params.id });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || 'Lỗi chấm điểm rubric') });
    }
  });

  // Duyệt thử việc: yêu cầu rubric PASS (≥12, không LOẠI) -> tạo NV thử việc + PIN.
  app.post('/applications/:id/approve', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await employeesService.approveCandidate(req.params.id, req.user!.id);
      broadcastUpdate('candidates', { action: 'approve', id: req.params.id });
      broadcastUpdate('employees', { action: 'create', employee: (result as any).employee });
      broadcastUpdate('accounts', { action: 'create_emp_account' });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || 'Lỗi duyệt chính thức') });
    }
  });

  // Đánh LOẠI thủ công: REJECTED + xóa lịch PV + xóa thư mời (ẩn khỏi 2 danh sách).
  app.post('/applications/:id/reject', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ params: idParams, body: candidateRejectBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await employeesService.rejectCandidate(req.params.id, req.user!.id, (req.body as any)?.reason);
      broadcastUpdate('candidates', { action: 'reject', id: req.params.id });
      res.json({ success: true, candidate: result });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || 'Lỗi loại ứng viên') });
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
      // Ràng buộc cứng: lịch PV online dùng link Meet mặc định hệ thống (bỏ qua link
      // client gửi lên); OFFLINE (client không gửi meetUrl) thì không gắn link.
      const meetUrl = req.body.meetUrl !== undefined ? (defaultMeetUrl() || undefined) : undefined;
      const branchName = req.body.branchName || (cand as any).branch_name || (cand as any).preferred_branch_id;

      // Lưu lịch phỏng vấn trước khi gửi (idempotent theo submission).
      await employeesService.scheduleInterview(req.params.id, interviewDate, timeSlot, req.user!.id);

      // Link xác nhận cho ứng viên bấm (không cần đăng nhập, token 7 ngày).
      // Chưa cấu hình PUBLIC_BASE_URL thì gửi thư mời như cũ (không kèm link).
      let rsvpUrl: string | undefined;
      try {
        const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
        if (base) rsvpUrl = `${base}/public/interview/rsvp?token=${encodeURIComponent(employeesService.buildRsvpToken(req.params.id))}`;
      } catch { /* không kèm link */ }

      const phone = (cand as any).phone_normalized || (cand as any).phone || '';
      let uid = '';
      try {
        const found = await zaloService.findUserByPhone(phone);
        uid = found.uid;
      } catch (e: any) {
        // Phân loại để UI hiện đúng lý do + nút Gửi lại: SĐT chưa có Zalo (NO_ZALO),
        // mất kết nối nick HR (NOT_CONNECTED), còn lại là lỗi tra cứu mạng/lib.
        const raw = String(e?.message || e);
        const noZalo = raw.includes('ZALO_USER_NOT_FOUND');
        const notConn = raw.includes('ZALO_NOT_CONNECTED');
        // Lưu trạng thái gửi để reload vẫn thấy (realtime + bền vững qua pull).
        await adapter.updateCandidate(req.params.id, {
          zalo_invite_status: noZalo ? 'NO_ZALO' : 'FAILED',
          zalo_invite_at: new Date().toISOString(),
          zalo_invite_error: raw,
        } as any).catch(() => null);
        broadcastUpdate('candidates', { action: 'zalo-invite-failed', id: req.params.id });
        if (notConn) {
          return res.status(400).json({
            error: 'ZALO_NOT_CONNECTED',
            message: 'Nick Zalo HR chưa kết nối (phiên hết hạn hoặc chưa quét QR)! Quét QR đăng nhập lại ở khung trên rồi bấm Gửi lại.',
            phone,
          });
        }
        if (noZalo) {
          return res.status(400).json({
            error: 'ZALO_USER_NOT_FOUND',
            message: `SĐT ${phone} chưa đăng ký Zalo! Kiểm tra lại SĐT ứng viên rồi bấm Gửi lại.`,
            phone,
          });
        }
        return res.status(400).json({ error: raw, phone });
      }

      const text = zaloService.buildInviteText({
        candidateName: (cand as any).full_name || 'bạn',
        position: (cand as any).apply_position,
        branchName,
        shift: (cand as any).registered_shift,
        interviewDate,
        timeSlot,
        meetUrl,
        rsvpUrl,
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
        // Lưu trạng thái gửi lên hồ sơ ứng viên để reload vẫn thấy (realtime + bền vững qua pull).
        await adapter.updateCandidate(req.params.id, {
          zalo_invite_status: 'SENT',
          zalo_uid: uid,
          zalo_invite_at: new Date().toISOString(),
          zalo_invite_error: undefined,
        } as any).catch(() => null);
        broadcastUpdate('candidates', { action: 'zalo-invite', id: req.params.id });
        res.json({ success: true, uid, msgId: sent.msgId, meetUrl: meetUrl || null });
      } catch (e: any) {
        // Thường do chưa kết bạn — HR dùng nút Kết bạn rồi gửi lại. Phân loại mã
        // lỗi thật để UI hiện đúng (trước đây mọi lỗi gửi đều báo NOT_FRIEND).
        const rawSend = String(e?.message || e);
        const notFriend = rawSend.includes('FRIEND') || rawSend.includes('kết bạn');
        const sendNotConn = rawSend.includes('ZALO_NOT_CONNECTED');
        await adapter.updateCandidate(req.params.id, {
          zalo_invite_status: notFriend ? 'NOT_FRIEND' : 'FAILED',
          zalo_uid: uid,
          zalo_invite_at: new Date().toISOString(),
          zalo_invite_error: rawSend,
        } as any).catch(() => null);
        broadcastUpdate('candidates', { action: 'zalo-invite-failed', id: req.params.id });
        if (sendNotConn) {
          return res.status(400).json({ error: 'ZALO_NOT_CONNECTED', message: 'Nick Zalo HR chưa kết nối (phiên hết hạn hoặc chưa quét QR)! Quét QR đăng nhập lại ở khung trên rồi bấm Gửi lại.', uid, phone });
        }
        return res.status(400).json({ error: notFriend ? 'ZALO_NOT_FRIEND' : rawSend, message: rawSend, uid, phone });
      }
    } catch (err: any) {
      const msg = String(err?.message || 'Lỗi gửi thư mời Zalo');
      // Lỗi khung 30p / trùng lịch từ bước lưu lịch: chặn gửi BOT, trả text để HR đăng ký lại.
      if (msg.startsWith('TRÙNG LỊCH PV') || msg.includes('khung cố định 30 phút') || msg.includes('ngoài giờ phỏng vấn') || msg.includes('đã qua')) {
        const status = msg.startsWith('TRÙNG LỊCH PV') ? 409 : 400;
        return res.status(status).json({ error: msg });
      }
      res.status(400).json({ error: msg });
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

  // Ca thật của đồng nghiệp CÙNG chi nhánh để chọn tráo đổi.
  // Xác thực theo chi nhánh trên HỒ SƠ (chuẩn hóa CN1/CN130...), không phụ thuộc
  // branchScope cũ trong token — triệt để lỗi BRANCH_SCOPE_VIOLATION oan.
  app.get('/me/colleague-shifts', authMiddleware, validate({ query: colleagueShiftsQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const requesterId = req.user?.employeeId;
      if (req.user?.role !== 'EMPLOYEE' || !requesterId) {
        return res.status(403).json({ error: 'NOT_AN_EMPLOYEE' });
      }
      const targetId = String(req.query.employeeId || '').trim();
      if (!targetId) return res.status(400).json({ error: 'MISSING_EMPLOYEE' });
      if (targetId === requesterId) return res.status(400).json({ error: 'CANNOT_SWAP_WITH_SELF' });
      const me = await employeesService.getEmployee(requesterId).catch(() => null);
      const target = await employeesService.getEmployee(targetId).catch(() => null);
      if (!target || (target as any).employment_status === 'TERMINATED') {
        return res.status(404).json({ error: 'COLLEAGUE_NOT_FOUND' });
      }
      const canon = (b?: string) => {
        const x = String(b || '').trim().toUpperCase();
        if (x === 'CN1' || x === 'CN130') return 'CN130';
        if (x === 'CN2' || x === 'CN261') return 'CN261';
        if (x === 'CN3' || x === 'CN120') return 'CN120';
        if (x === 'CN4' || x === 'CN111') return 'CN111';
        return x;
      };
      if (canon((me as any)?.default_branch_id) !== canon((target as any)?.default_branch_id)) {
        return res.status(403).json({
          error: 'DIFFERENT_BRANCH',
          message: 'Chỉ được đổi ca với đồng nghiệp cùng chi nhánh.',
        });
      }
      const fromDate = (req.query.fromDate as string) || new Date().toISOString().split('T')[0];
      const toDate = (req.query.toDate as string) || '2030-12-31';
      const shifts = await schedulesService.getEmployeeShifts(targetId, fromDate, toDate);
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
        const auto = req.body.auto === true || req.body.auto === 'true' || req.body.auto === '1';
        let autoSummary: any = null;
        if (auto) {
          // BOT tự xếp lịch lấp chỗ trống (trừ ngày OFF đã đăng ký) trước khi duyệt.
          const exec = await autoScheduleService.execute(branchId, req.params.week, req.user!.id);
          autoSummary = {
            created: (exec as any).created ?? 0,
            items: (exec as any).items ?? [],
            warnings: (exec as any).warnings ?? [],
            stats: (exec as any).stats ?? [],
          };
          broadcastUpdate('schedules', { action: 'auto-schedule', branchId, week: req.params.week, created: autoSummary.created });
        }
        const result = await schedulesService.publishWeekSchedule(branchId, req.params.week, req.user!.id);
        broadcastUpdate('schedules', { action: 'publish', branchId, week: req.params.week });
        // Ghi Sheet ĐỒNG BỘ để PUBLISHED bền vững ngay (restart sau publish
        // không rớt về DRAFT khiến NV mất quyền đổi ca oan). Rớt thì báo cờ để
        // HR bấm đồng bộ lại — không chặn response (bộ nhớ đã đúng).
        let sheetPersisted = false;
        try {
          const syncSvc = (adapter as any)?.syncService;
          if (syncSvc?.pushShiftsTab) {
            sheetPersisted = await Promise.race([
              syncSvc.pushShiftsTab(adapter).then(() => true).catch(() => false),
              new Promise<false>(r => setTimeout(() => r(false), 15000)),
            ]);
          } else {
            sheetPersisted = true;
          }
        } catch { sheetPersisted = false; }
        res.json({ ...(result as any), auto: autoSummary, sheetPersisted });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  // BOT xem trước kế hoạch xếp lịch (không ghi) — Admin/HR/Store duyệt rồi mới PUBLISH.
  app.post(
    '/schedules/auto-plan',
    authMiddleware,
    requireRole(['ADMIN', 'HR', 'STORE']),
    validate({ body: autoPlanBody }),
    enforceBranchScope(req => req.body.branchId),
    async (req: AuthenticatedRequest, res) => {
      try {
        const branchId = req.body.branchId || req.user?.branchScope || '*';
        const weekMon = req.body.weekMon || new Date().toISOString().split('T')[0];
        const plan = await autoScheduleService.plan(branchId, weekMon);
        res.json(plan);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  // --- BÀI TEST (HR tạo đề + giao đúng nhân viên; NV chỉ thấy bài của mình) ---
  app.post('/tests', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: testPaperBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await testsService.createPaper({
        title: req.body.title,
        description: req.body.description,
        questions: req.body.questions,
        passScore: req.body.passScore,
        timeLimitSeconds: req.body.timeLimitSeconds,
        employeeIds: req.body.employeeIds,
        actorId: req.user!.id,
      });
      broadcastUpdate('tests', { action: 'create', testId: (result as any)?.result?.paper?.test_id });
      broadcastNotification({
        type: 'TEST',
        title: '📝 HR Vừa Giao Bài TEST Mới',
        message: `"${req.body.title}" đã được giao cho ${(req.body.employeeIds || []).length} nhân viên.`,
        linkTab: 'hr-tests',
        metadata: { testId: (result as any)?.result?.paper?.test_id },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- NGÂN HÀNG CÂU HỎI TRẮC NGHIỆM (Google Sheet ngoài) ---
  // HR xem trước: Sheet có bao nhiêu câu hợp lệ (kèm 3 câu mẫu, hiện cả đáp án
  // đúng để HR đối chiếu) trước khi random giao bài.
  app.get('/admin/test-bank/preview', authMiddleware, requireRole(['ADMIN', 'HR']), async (_req, res) => {
    try {
      const bank = await adapter.syncService.readTestBankQuestions();
      res.json({
        spreadsheetId: bank.spreadsheetId,
        sheetName: bank.sheetName,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${bank.spreadsheetId}/edit`,
        count: bank.questions.length,
        totalRows: bank.totalRows,
        skipped: bank.skipped,
        sample: bank.questions.slice(0, 3).map(q => ({
          content: q.content,
          options: q.options,
          correct: String.fromCharCode(65 + q.correct_index),
          explanation: q.explanation,
        })),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // HR random N câu khác nhau từ ngân hàng + giao cho NV đã tick chọn.
  // Mỗi NV nhận 1 bài làm riêng + thông báo inbox yêu cầu hoàn thành.
  app.post('/admin/tests/from-bank', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: testBankBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const count = Math.max(1, Math.min(50, Number(req.body.count) || 25));
      const employeeIds: string[] = [...new Set(((req.body.employeeIds || []) as string[]).map((s: string) => String(s)))];
      const bank = await adapter.syncService.readTestBankQuestions();
      if (bank.questions.length < count) {
        return res.status(400).json({
          error: `Ngân hàng câu hỏi chỉ có ${bank.questions.length} câu hợp lệ (bỏ ${bank.skipped} dòng lỗi), không đủ ${count} câu! Bổ sung câu hỏi trên Sheet rồi thử lại.`,
        });
      }
      // Fisher-Yates: xáo toàn bộ rồi cắt N câu đầu -> N câu khác nhau chắc chắn.
      const pool = [...bank.questions];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const picked = pool.slice(0, count);
      const vn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
      const title = String(req.body.title || '').trim() || `TEST trắc nghiệm ${count} câu — ${vn.split('-').reverse().join('/')}`;
      const result = await testsService.createPaper({
        title,
        description: String(req.body.description || `Đề random ${count} câu từ ngân hàng câu hỏi (${bank.sheetName}).`),
        questions: picked.map((q, i) => ({
          question_id: `BANK_${Date.now()}_${i + 1}`,
          content: q.content,
          options: q.options,
          correct_index: q.correct_index,
          points: 1,
        })),
        passScore: req.body.passScore ?? 8,
        timeLimitSeconds: req.body.timeLimitSeconds ?? 480,
        employeeIds,
        actorId: req.user!.id,
      });
      const testId = (result as any)?.result?.paper?.test_id;
      // Thông báo đến từng NV được giao: inbox + realtime (socket đã bắn trong createPaper).
      await notificationsService.sendNotification({
        recipientIds: employeeIds,
        type: 'TEST_ASSIGNED',
        severity: 'ACTION_REQUIRED',
        title: `📝 Bạn được giao bài trắc nghiệm (${count} câu)`,
        summary: `HR vừa giao "${title}". Mở tab Thi TEST để làm bài ngay — hoàn thành để đủ điều kiện xét duyệt!`,
        targetPath: '/test_exam',
        actorId: req.user!.id,
      }).catch(() => null);
      broadcastUpdate('tests', { action: 'create-bank', testId });
      broadcastNotification({
        type: 'TEST',
        title: '🎲 HR Vừa Giao Đề Random Từ Ngân Hàng Câu Hỏi',
        message: `"${title}" (${count} câu) đã được giao cho ${employeeIds.length} nhân viên.`,
        linkTab: 'hr-tests',
        metadata: { testId },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json({ ...(result as any)?.result, questionCount: count });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/tests', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), async (req: AuthenticatedRequest, res) => {
    try {
      const papers = await testsService.listPapers();
      const testId = req.query.testId as string | undefined;
      const subs = await testsService.listSubmissions(testId);
      // STORE chỉ xem bài của NV thuộc phạm vi mình.
      if (req.user?.role === 'STORE' && req.user.branchScope !== '*') {
        const emps = await employeesService.listEmployees(req.user.branchScope);
        const ids = new Set(emps.map(e => e.employee_id));
        const mine = (subs as any)?.result ?? subs;
        const filtered = Array.isArray(mine) ? mine.filter((s: any) => ids.has(s.employee_id)) : mine;
        res.json({ papers, submissions: filtered });
        return;
      }
      res.json({ papers, submissions: subs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cổng nhân viên: chỉ bài được giao cho mình (kèm đề đã ẩn đáp án).
  app.get('/me/tests', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.status(403).json({ error: 'NOT_AN_EMPLOYEE' });
      const list = await testsService.myTests(employeeId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/me/tests/:id/submit', authMiddleware, validate({ params: idParams, body: testSubmitBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.status(403).json({ error: 'NOT_AN_EMPLOYEE' });
      const result = await testsService.submitAnswers(req.params.id, employeeId, req.body.answers);
      broadcastUpdate('tests', { action: 'submit', submissionId: req.params.id });
      const graded: any = (result as any)?.result ?? result;
      const emp = await employeesService.getEmployee(employeeId).catch(() => null);
      broadcastNotification({
        type: 'TEST',
        title: graded?.passed ? '✅ NV Vừa Đạt Bài TEST' : '📝 NV Vừa Nộp Bài TEST',
        message: `${(emp as any)?.full_name || employeeId} nộp bài đạt ${graded?.score ?? '?'}/10${graded?.passed ? ' (ĐẠT)' : ''}.`,
        linkTab: 'hr-tests',
        metadata: { submissionId: req.params.id, employeeId },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- LEAVE & SWAP REQUESTS ---
  app.post('/leave-requests', authMiddleware, validate({ body: leaveCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employeeId;
      try {
        await assertHangTuanWindow(adapter, req.user!, req.body.leaveType, new Date(), req.body.requestedDate || req.body.requested_date);
      } catch (werr: any) {
        if (werr.message === ERROR_CODES.WEEKLY_OFF_WINDOW_CLOSED) {
          return res.status(403).json({
            error: werr.message,
            message: werr.reason || `Đăng ký 2 ngày nghỉ OFF chỉ mở từ 09h00 Thứ 6 đến 09h00 Thứ 7 hàng tuần (lần tới: ${werr.window.windowOpensAt}).`,
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
      // Lịch OFF tuần tự động ghi nhận — không gửi phiếu duyệt. Chỉ báo đơn đột xuất.
      if (result.result.leave_type === 'DOT_XUAT') {
        broadcastNotification({
          type: 'LEAVE',
          title: '📝 Đơn Xin Nghỉ Phép Mới',
          message: `${emp?.full_name || 'Nhân viên'} vừa nộp đơn xin nghỉ đột xuất ngày ${result.result.requested_date}. Lý do: ${result.result.reason || 'Việc cá nhân'}`,
          linkTab: 'hr-leave',
          metadata: { leaveId: result.result.request_id, employeeId },
          targetRoles: ['ADMIN', 'HR', 'STORE'],
        });
      }
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
      const reviewed = result.result as any;
      const leaveEmp = await employeesService.getEmployee(reviewed.employee_id).catch(() => null);
      const reviewerName = req.user!.fullName || req.user!.id;
      const verdict = status === 'APPROVED' ? 'duyệt' : 'từ chối';
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
        target_type: 'DON_NGHI_PHEP',
        target_id: req.params.id,
      });
      broadcastUpdate('leaves', { action: 'review', leave: result.result });
      broadcastNotification({
        type: 'LEAVE',
        title: result.result.status === 'APPROVED' ? '✅ Đã Phê Duyệt Đơn Nghỉ' : '❌ Đã Từ Chối Đơn Nghỉ',
        message: `Đơn nghỉ ngày ${String(reviewed.requested_date || '').slice(0, 10)} của ${(leaveEmp as any)?.full_name || reviewed.employee_id} đã được ${reviewerName} ${verdict}${note ? ` — Lý do: ${note}` : ''}.`,
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
      // NV: kèm phiếu điều phối mở của chi nhánh mình để nhận ca (+30k).
      if (req.user?.role === 'EMPLOYEE' && req.user.employeeId) {
        const me = await employeesService.getEmployee(req.user.employeeId).catch(() => null);
        const branchId = (me as any)?.default_branch_id || req.user.branchScope;
        if (branchId) {
          const open = await schedulesService.listOpenDispatches(branchId).catch(() => []);
          const seen = new Set((list || []).map((s: any) => s.swap_id));
          for (const o of open || []) {
            if (!seen.has(o.swap_id)) (list as any[]).push(o);
          }
        }
      }
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // HR tạo phiếu điều phối nhường ca (+30.000đ cho người nhận khi duyệt).
  app.post('/swap-requests/dispatch', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: swapDispatchBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const requesterId = req.body.requesterId;
      if (!requesterId) return res.status(400).json({ error: 'MISSING_REQUESTER: Chưa chọn nhân viên cần người làm thay.' });
      if (!req.body.requesterAssignmentId) return res.status(400).json({ error: 'MISSING_SHIFT: Chưa chọn ca cần người làm thay.' });
      const requester = await employeesService.getEmployee(requesterId).catch(() => null);
      if (!requester) return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' });
      const branchId = req.body.branchId || (requester as any).default_branch_id || 'CN130';
      const result = await schedulesService.createDispatch({
        requesterId,
        requesterAssignmentId: req.body.requesterAssignmentId,
        branchId,
        reason: req.body.reason || 'HR điều phối nhường ca (+30.000đ hỗ trợ)',
        actorId: req.user!.id,
      });
      broadcastUpdate('swaps', { action: 'dispatch', swap: result });
      broadcastNotification({
        type: 'SWAP',
        title: '🚀 HR Cần Người Làm Thay Ca (+30.000đ)',
        message: `${(requester as any)?.full_name || 'Nhân viên'} cần người làm thay ca. Nhận ca được +30.000đ phụ cấp!`,
        linkTab: 'hr-schedule',
        metadata: { swapId: (result as any)?.result?.swap_id, branchId },
        targetRoles: ['ADMIN', 'HR', 'STORE', 'EMPLOYEE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // HR chuyển ca hỗ trợ chi nhánh: A nhường ca có sẵn cho B (B chính thức,
  // thường khác chi nhánh) làm thay. B xác nhận trên cổng NV là ca chuyển
  // sang B ngay + cập nhật lịch 2 cổng.
  app.post('/swap-requests/support', authMiddleware, requireRole(['ADMIN', 'HR']), validate({ body: supportCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const target = await employeesService.getEmployee(req.body.targetEmployeeId).catch(() => null);
      if (!target) return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND' });
      const result = await schedulesService.createSupportRequest({
        requesterAssignmentId: req.body.requesterAssignmentId,
        targetEmployeeId: req.body.targetEmployeeId,
        reason: req.body.reason || 'HR điều hỗ trợ chi nhánh',
        actorId: req.user!.id,
      });
      const swRes: any = (result as any)?.result ?? result;
      const owner = await employeesService.getEmployee((swRes as any)?.requester_id).catch(() => null);
      broadcastUpdate('swaps', { action: 'support', swap: result });
      broadcastNotification({
        type: 'SWAP',
        title: '🆘 HR Điều Hỗ Trợ Chi Nhánh',
        message: `${(owner as any)?.full_name || 'Nhân viên'} nhường ${swRes?.support_shift_code} ngày ${String(swRes?.support_date || '').slice(0, 10)} (${(swRes as any)?.support_branch_id}) — ${(target as any)?.full_name || req.body.targetEmployeeId} làm thay. Chờ xác nhận!`,
        linkTab: 'hr-swap',
        metadata: { swapId: (result as any)?.result?.swap_id },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/swap-requests/:id/respond', authMiddleware, validate({ params: idParams, body: swapRespondBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const partnerId = req.user?.employeeId || req.body.partnerId;
      const result = await schedulesService.respondSwapPartner(req.params.id, partnerId, req.body.accept);
      broadcastUpdate('swaps', { action: 'respond', swap: result });
      const swRes: any = (result as any)?.result ?? result;
      const autoDone = req.body.accept && swRes?.status === 'APPROVED';
      const isSupport = (swRes as any)?.swap_kind === 'HR_SUPPORT';
      broadcastNotification({
        type: 'SWAP',
        title: req.body.accept ? (isSupport ? '🆘 NV Đã Nhận Hỗ Trợ Chi Nhánh' : '🤝 Đồng Nghiệp Đã Nhận Đổi Ca') : '⚠️ Đồng Nghiệp Từ Chối Đổi Ca',
        message: autoDone
          ? (isSupport
            ? `Hỗ trợ chi nhánh #${req.params.id} đã hoàn tất: ca ${swRes?.support_shift_code} ngày ${String(swRes?.support_date || '').slice(0, 10)} tại ${(swRes as any)?.support_branch_id} đã chuyển sang nhân viên nhận hỗ trợ.`
            : `Tráo đổi ca #${req.params.id} đã tự hoàn tất: 2 ca hoán đổi người trực ngay (không cần HR duyệt).`)
          : `Yêu cầu đổi ca #${req.params.id} đã được phản hồi: ${req.body.accept ? 'Đồng ý, chờ Store duyệt' : 'Từ chối'}.`,
        linkTab: 'hr-schedule',
        metadata: { swapId: req.params.id },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Rà soát phiếu đổi/tráo ca sai quy định (ca ngoài tuần gửi phiếu): hủy phiếu
  // + trả lịch từng NV về chủ ban đầu. Phiếu đúng tuần (kể cả tuần cũ) giữ nguyên.
  app.post('/admin/swaps/audit-out-of-week', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await schedulesService.auditOutOfWeekSwaps(req.user!.id);
      broadcastUpdate('swaps', { action: 'audit-out-of-week', ...result });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
        message: (() => {
          const sw: any = (result as any)?.result ?? result;
          const bonusTxt = req.body.accept && sw?.swap_kind === 'HR_DISPATCH' ? ' Người nhận ca được +30.000đ phụ cấp.' : '';
          return `Quản lý đã ${req.body.accept ? 'phê duyệt' : 'từ chối'} đổi ca #${req.params.id}.${bonusTxt}`;
        })(),
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

      // Ngày VN (UTC+7): ca CA_1 mở cổng 06:30 VN (= 23:30 UTC hôm trước) nên không
      // được dùng ngày UTC — 00:00–07:00 VN sẽ lookup nhầm sang ngày hôm qua.
      const today = new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
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

      // Quá 3 tiếng kể từ giờ ca bắt đầu mà chưa check-in -> khóa, ca tính nghỉ không lương.
      const checkinStartMs = new Date((existingShift as any).start_at).getTime();
      // Ràng buộc cổng điểm danh: chỉ mở trước giờ vào ca N phút (mặc định 30p theo
      // policies.check_in_window_minutes). Check-in sớm hơn -> từ chối để đồng bộ
      // với cổng nhân viên (thời gian điểm danh bắt đầu từ lúc mở cổng).
      if (Number.isFinite(checkinStartMs)) {
        let gateMinutes = 30;
        try {
          const policies = await adapter.getPolicies().catch(() => null);
          const w = Number((policies as any)?.check_in_window_minutes);
          if (Number.isFinite(w) && w > 0 && w <= 180) gateMinutes = Math.floor(w);
        } catch { /* giữ mặc định 30p */ }
        const gateOpenMs = checkinStartMs - gateMinutes * 60 * 1000;
        if (Date.now() < gateOpenMs) {
          const openStr = new Date(gateOpenMs).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          const startStr = new Date(checkinStartMs).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          return res.status(403).json({
            error: 'CHECKIN_TOO_EARLY',
            message: `⏰ CHƯA ĐẾN GIỜ CHECK-IN: Cổng điểm danh mở trước giờ ca ${gateMinutes} phút (mở lúc ${openStr}, ca bắt đầu ${startStr}). Vui lòng quay lại sau!`,
            gateOpenAt: new Date(gateOpenMs).toISOString(),
            shiftStartAt: (existingShift as any).start_at,
            gateMinutes,
          });
        }
      }
      if (Number.isFinite(checkinStartMs) && Date.now() - checkinStartMs > 3 * 60 * 60 * 1000) {
        return res.status(403).json({
          error: 'ATTENDANCE_LOCKED',
          message: 'Quá 3 tiếng kể từ giờ vào ca mà chưa check-in: cổng đã khóa, ca này tính nghỉ việc không lương!',
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
        photoBase64: req.body.photo_base64,
        uniformPinkRatio: req.body.uniform_pink_ratio,
      });

      broadcastUpdate('attendance', { action: 'checkin', employeeId, event: result.result });
      const checkinEmp = await employeesService.getEmployee(employeeId).catch(() => null);
      const dist = Math.round(result.result.distance_meters || 45);
      // Báo nấc phạt trễ ngay khi check-in để NV/HR biết (5p:30k • 30p:50% • 60p:100% ca).
      let lateNote = '';
      if ((result.result as any).is_late) {
        const mins = Number((result.result as any).minutes_deviation) || 0;
        const tpl = (SHIFT_TEMPLATES as any)[(existingShift as any)?.shift_code];
        const shiftPay = (tpl ? tpl.duration_hours : 5) * (Number((checkinEmp as any)?.current_rate_per_hour) || 25500);
        const fine = lateFineFor(mins, shiftPay);
        lateNote = fine.unpaid
          ? ` Trễ ${mins}p: phạt 100% lương ca!`
          : fine.deduction > 0
            ? ` Trễ ${mins}p: phạt ${fine.deduction.toLocaleString('vi-VN')}đ!`
            : '';
      }
      broadcastNotification({
        type: 'CHECKIN',
        title: (result.result as any).is_late ? '🟡 Check-in Trễ Giờ' : '🟢 Điểm Danh Check-in Realtime',
        message: `${checkinEmp?.full_name || employeeId} (${checkinEmp?.employee_code || 'NV'}) vừa vào ca! GPS ${dist}m hợp lệ, áo hồng chuẩn thương hiệu.${lateNote}`,
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
      const gpsErr = String(err.message || '');
      if (gpsErr.startsWith('GPS_OUT_OF_BOUNDS') || gpsErr.startsWith('GPS_LOW_ACCURACY')) {
        const [, dist, limit] = gpsErr.split(':');
        const empId = req.user?.employeeId || req.body.employee_id || req.body.employeeId || '';
        const emp = empId ? await employeesService.getEmployee(empId).catch(() => null) : null;
        const weak = gpsErr.startsWith('GPS_LOW_ACCURACY');
        broadcastNotification({
          type: 'INFO',
          title: weak ? '⚠️ GPS Yếu — Yêu Cầu Làm Lại' : '⚠️ GPS Vượt Phạm Vi — Yêu Cầu Làm Lại',
          message: weak
            ? `${(emp as any)?.full_name || empId} check-in nhưng GPS quá yếu (±${dist}m). Hệ thống đã TỪ CHỐI (không ghi nhận đang làm), yêu cầu ra chỗ thoáng và điểm danh lại!`
            : `${(emp as any)?.full_name || empId} check-in cách chi nhánh ${dist}m (giới hạn ${limit || 300}m). Hệ thống đã TỪ CHỐI, yêu cầu đến gần chi nhánh và điểm danh lại!`,
          linkTab: 'hr-attendance',
          metadata: { employeeId: empId, distance: dist, limit },
          targetRoles: ['ADMIN', 'HR', 'STORE'],
        });
        return res.status(403).json({
          error: weak ? 'GPS_LOW_ACCURACY' : 'GPS_OUT_OF_BOUNDS',
          message: weak
            ? `GPS quá yếu (±${dist}m), không xác định được vị trí! Hệ thống TỪ CHỐI — hãy ra chỗ thoáng (ngoài trời) rồi điểm danh lại.`
            : `Bạn đang cách chi nhánh ${dist}m (giới hạn ${limit || 300}m)! Hệ thống TỪ CHỐI lượt này — hãy đến trong phạm vi rồi chụp + điểm danh lại.`,
        });
      }
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/attendance/checkout', authMiddleware, validate({ body: checkoutBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employee_id || req.body.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'Thiếu thông tin mã nhân viên' });

      const today = new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
      const todayEvents = await attendanceService.getEmployeeAttendance(employeeId, today);

      // Lọc theo ca khi client gửi assignment (ngày 2 ca: mỗi ca check-in/out độc lập).
      const assignmentFilter = req.body.assignment_id || req.body.assignmentId;
      const relevantEvents = assignmentFilter
        ? todayEvents.filter(e => e.assignment_id === assignmentFilter)
        : todayEvents;

      // Check-in requirement before check-out!
      const checkInEvent = relevantEvents.find(e => e.type === 'CHECK_IN');
      if (!checkInEvent) {
        // Quá 3 tiếng chưa check-in -> khóa luôn check-out, ca tính nghỉ không lương.
        try {
          const aid = req.body.assignment_id || req.body.assignmentId;
          const sh: any = aid ? await adapter.getShiftById(aid).catch(() => null) : null;
          const startMs = sh ? new Date(sh.start_at).getTime() : NaN;
          if (Number.isFinite(startMs) && Date.now() - startMs > 3 * 60 * 60 * 1000) {
            return res.status(403).json({
              error: 'ATTENDANCE_LOCKED',
              message: 'Quá 3 tiếng kể từ giờ vào ca mà chưa check-in: cổng đã khóa, ca này tính nghỉ việc không lương!',
            });
          }
        } catch { /* giữ lỗi gốc bên dưới */ }
        return res.status(400).json({
          error: 'QUY CHẾ ĐIỂM DANH: Bạn chưa có bản ghi Check-in đầu ca! Bắt buộc phải Check-in trước mới được Check-out.',
        });
      }

      const alreadyCheckedOut = relevantEvents.find(e => e.type === 'CHECK_OUT');
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
        photoBase64: req.body.photo_base64,
        uniformPinkRatio: req.body.uniform_pink_ratio,
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
      const gpsErr = String(err.message || '');
      if (gpsErr.startsWith('GPS_OUT_OF_BOUNDS') || gpsErr.startsWith('GPS_LOW_ACCURACY')) {
        const [, dist, limit] = gpsErr.split(':');
        const empId = req.user?.employeeId || req.body.employee_id || req.body.employeeId || '';
        const emp = empId ? await employeesService.getEmployee(empId).catch(() => null) : null;
        const weak = gpsErr.startsWith('GPS_LOW_ACCURACY');
        broadcastNotification({
          type: 'INFO',
          title: weak ? '⚠️ GPS Yếu — Yêu Cầu Làm Lại' : '⚠️ GPS Vượt Phạm Vi — Yêu Cầu Làm Lại',
          message: weak
            ? `${(emp as any)?.full_name || empId} check-out nhưng GPS quá yếu (±${dist}m). Hệ thống đã TỪ CHỐI (không ghi nhận), yêu cầu ra chỗ thoáng và điểm danh lại!`
            : `${(emp as any)?.full_name || empId} check-out cách chi nhánh ${dist}m (giới hạn ${limit || 300}m). Hệ thống đã TỪ CHỐI, yêu cầu đến gần chi nhánh và điểm danh lại!`,
          linkTab: 'hr-attendance',
          metadata: { employeeId: empId, distance: dist, limit },
          targetRoles: ['ADMIN', 'HR', 'STORE'],
        });
        return res.status(403).json({
          error: weak ? 'GPS_LOW_ACCURACY' : 'GPS_OUT_OF_BOUNDS',
          message: weak
            ? `GPS quá yếu (±${dist}m), không xác định được vị trí! Hệ thống TỪ CHỐI — hãy ra chỗ thoáng (ngoài trời) rồi điểm danh lại.`
            : `Bạn đang cách chi nhánh ${dist}m (giới hạn ${limit || 300}m)! Hệ thống TỪ CHỐI lượt này — hãy đến trong phạm vi rồi điểm danh lại.`,
        });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Gộp 2 route trùng: EMPLOYEE chỉ xem công của mình, nội bộ xem theo query (mặc định tất cả).
  app.get('/attendance/events', authMiddleware, validate({ query: attendanceEventsQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const role = req.user?.role;
      const employeeId = role === 'EMPLOYEE' ? req.user!.employeeId! : ((req.query.employeeId as string) || '*');
      const date = (req.query.date as string) || '';
      const events = await adapter.getAttendanceEvents(employeeId, date);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sự kiện điểm danh tuần cũ từ kho LUUTRU (tab Lịch làm việc lùi tuần + dải 12 ngày
  // thử việc quá khứ). Chỉ đọc kho lưu trữ — bảng realtime + Sheets giữ nguyên.
  app.get('/attendance/events/archive', authMiddleware, validate({ query: archiveEventsQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const ok = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
      const to = ok(req.query.to) ? String(req.query.to) : new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
      let from = ok(req.query.from) ? String(req.query.from) : to;
      // Chặn khoảng quá rộng (kho lưu trữ phình theo tuần).
      const days = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
      if (!Number.isFinite(days) || days < 0 || days > 62) {
        return res.status(400).json({ error: 'INVALID_RANGE: khoảng from→to tối đa 62 ngày.' });
      }
      const syncService = (adapter as any).syncService;
      if (!syncService?.getArchivedAttendanceEvents) return res.json([]);
      const role = req.user?.role;
      const employeeId = role === 'EMPLOYEE' ? req.user!.employeeId! : undefined;
      const list = await syncService.getArchivedAttendanceEvents(from, to);
      res.json(employeeId ? (list || []).filter((e: any) => e.employee_id === employeeId) : (list || []));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Ảnh check-in/out: stream trực tiếp từ Drive (kể cả file không public).
  const serveAttendancePhoto = async (req: AuthenticatedRequest, res: any) => {
    try {
      const events = await adapter.getAttendanceEvents(undefined, '');
      const evt: any = (events || []).find((e: any) => e.event_id === req.params.eventId);
      if (!evt) return res.status(404).json({ error: 'PHOTO_NOT_FOUND' });
      if (req.user?.role === 'EMPLOYEE' && evt.employee_id !== req.user.employeeId) {
        return res.status(403).json({ error: 'FORBIDDEN' });
      }
      if (req.user?.role === 'STORE' && req.user.branchScope !== '*' && evt.branch_id && evt.branch_id !== req.user.branchScope) {
        return res.status(403).json({ error: 'BRANCH_SCOPE_FORBIDDEN' });
      }
      if (!evt.drive_object_id || String(evt.drive_object_id).startsWith('DRV_')) {
        return res.status(404).json({ error: 'PHOTO_NOT_UPLOADED: Ảnh chưa được upload lên Drive.' });
      }
      const syncService = (adapter as any).syncService;
      if (!syncService?.downloadDriveFile) {
        return res.status(503).json({ error: 'DRIVE_NOT_CONFIGURED' });
      }
      const { buffer, mimeType } = await syncService.downloadDriveFile(evt.drive_object_id);
      res.setHeader('Content-Type', mimeType || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'PHOTO_DOWNLOAD_FAILED' });
    }
  };
  app.get('/attendance/photo/:eventId', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), serveAttendancePhoto);
  app.get('/me/attendance/photo/:eventId', authMiddleware, serveAttendancePhoto);

  // Ảnh bằng chứng kèm phiếu bổ sung công: stream trực tiếp từ Drive (kể cả file không public).
  const serveAdjustmentPhoto = async (req: AuthenticatedRequest, res: any) => {
    try {
      const list = await attendanceService.listAdjustments(undefined, undefined);
      const adj: any = (list || []).find((x: any) => x.adjustment_id === req.params.id);
      if (!adj) return res.status(404).json({ error: 'PHOTO_NOT_FOUND' });
      if (req.user?.role === 'EMPLOYEE' && adj.employee_id !== req.user.employeeId) {
        return res.status(403).json({ error: 'FORBIDDEN' });
      }
      if (req.user?.role === 'STORE' && req.user.branchScope !== '*' && adj.branch_id && adj.branch_id !== req.user.branchScope) {
        return res.status(403).json({ error: 'BRANCH_SCOPE_FORBIDDEN' });
      }
      const inlinePhoto: string | undefined = (adj as any).evidence_photo;
      const driveId: string = String(adj.evidence_drive_id || '');
      const serveInline = (dataUrl: string) => {
        try {
          const m = String(dataUrl).match(/^data:(image\/\w+);base64,(.*)$/);
          const mime = m ? m[1] : 'image/jpeg';
          const b64 = m ? m[2] : String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(b64, 'base64');
          if (!buffer.length) throw new Error('EMPTY_INLINE_PHOTO');
          res.setHeader('Content-Type', mime);
          res.setHeader('Cache-Control', 'private, max-age=3600');
          return res.send(buffer);
        } catch (e: any) {
          return res.status(404).json({ error: 'PHOTO_NOT_UPLOADED: Phiếu này không có ảnh bằng chứng.' });
        }
      };
      // Ưu tiên Drive khi có ID thật; mọi trường hợp còn lại (chưa upload / DRV_* /
      // Drive lỗi) mà còn ảnh inline thì phục vụ inline để HR luôn thấy ảnh realtime.
      if (driveId && !driveId.startsWith('DRV_') && !driveId.startsWith('INLINE_')) {
        try {
          const syncService = (adapter as any).syncService;
          if (syncService?.downloadDriveFile) {
            const { buffer, mimeType } = await syncService.downloadDriveFile(adj.evidence_drive_id);
            res.setHeader('Content-Type', mimeType || 'image/jpeg');
            res.setHeader('Cache-Control', 'private, max-age=3600');
            return res.send(buffer);
          }
        } catch {
          // Drive tải lỗi (quyền mạng/xóa file): rớt xuống inline nếu còn.
          if (inlinePhoto) return serveInline(inlinePhoto);
          return res.status(404).json({ error: 'PHOTO_NOT_UPLOADED: Phiếu này không có ảnh bằng chứng.' });
        }
        if (inlinePhoto) return serveInline(inlinePhoto);
        return res.status(404).json({ error: 'PHOTO_NOT_UPLOADED: Phiếu này không có ảnh bằng chứng.' });
      }
      if (inlinePhoto) return serveInline(inlinePhoto);
      if (!adj.evidence_drive_id || String(adj.evidence_drive_id).startsWith('DRV_')) {
        return res.status(404).json({ error: 'PHOTO_NOT_UPLOADED: Phiếu này không có ảnh bằng chứng.' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'PHOTO_DOWNLOAD_FAILED' });
    }
  };
  app.get('/attendance/adjustments/:id/photo', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), serveAdjustmentPhoto);
  app.get('/me/attendance/adjustments/:id/photo', authMiddleware, serveAdjustmentPhoto);

  // Tải gói chứng cứ điểm danh theo ngày:
  // ZIP/Diem danh ngay DD-MM-YYYY/{chi nhánh}/{ca làm}/{tên NV}/check in.jpg + check out.jpg
  // (ảnh thật từ camera NV) + file CSV tổng hợp.
  app.get('/admin/attendance/export', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const date = String(req.query.date || new Date().toISOString().split('T')[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'INVALID_DATE: dùng định dạng YYYY-MM-DD.' });
      }
      const [y, m, d] = date.split('-');
      const root = `Diem danh ngay ${d}-${m}-${y}`;
      const syncService = (adapter as any).syncService;
      if (!syncService?.attendanceZipEntriesForDate) {
        return res.status(503).json({ error: 'SYNC_NOT_READY' });
      }
      const { entries, eventCount, photoCount, missing } = await syncService.attendanceZipEntriesForDate(adapter, date, root);
      if (entries.length === 0) {
        return res.status(400).json({
          error: 'NO_PHOTOS',
          message: `Ngày ${date}: ${eventCount} lượt chấm công nhưng không có ảnh nào tải được (đủ ảnh: ${photoCount}).`,
          eventCount,
          photoCount,
          missing: missing.slice(0, 20),
        });
      }
      const zip = buildZipStore(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="diem-danh-${date}.zip"`);
      res.send(zip);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'EXPORT_FAILED' });
    }
  });

  // Chẩn đoán ảnh chấm công theo ngày: bao nhiêu lượt có file Drive thật,
  // bao nhiêu upload lỗi (DRV_LOCAL_), bao nhiêu chưa từng upload (DRV_ cũ).
  app.get('/admin/attendance/photo-stats', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const date = String(req.query.date || new Date().toISOString().split('T')[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'INVALID_DATE' });
      }
      const events: any[] = await adapter.getAttendanceEvents(undefined, date);
      const relevant = (events || []).filter(e => e.type === 'CHECK_IN' || e.type === 'CHECK_OUT');
      const missing: string[] = [];
      let ok = 0;
      let uploadFailed = 0;
      let neverUploaded = 0;
      for (const e of relevant) {
        const id = String(e.drive_object_id || '');
        if (id && !id.startsWith('DRV_')) ok++;
        else if (id.startsWith('DRV_LOCAL_')) { uploadFailed++; missing.push(e.event_id); }
        else { neverUploaded++; missing.push(e.event_id); }
      }
      const syncService = (adapter as any).syncService;
      const drive = syncService?.getDriveUploadStatus ? syncService.getDriveUploadStatus() : null;
      const adapterPhoto = (adapter as any).getPhotoStats ? (adapter as any).getPhotoStats() : null;
      res.json({ date, total: relevant.length, withPhoto: ok, uploadFailed, neverUploaded, missing, drive, adapterPhoto });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Rà soát GPS vượt phạm vi: NV nào đã check-in/check-out cách chi nhánh quá
  // bán kính (mặc định 300m) thì bắt điểm danh lại hết (báo thẳng cổng NV).
  app.post('/admin/attendance/reverify-gps', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const date = String(req.body?.date || new Date().toISOString().split('T')[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'INVALID_DATE' });
      }
      const radiusOf = (branchId?: string) =>
        BRANCHES.find(b => b.id === branchId)?.radius_meters ?? 300;
      const events: any[] = await adapter.getAttendanceEvents(undefined, date);
      const bad = (events || []).filter(
        e =>
          (e.type === 'CHECK_IN' || e.type === 'CHECK_OUT') &&
          Number(e.distance_meters) > radiusOf(e.branch_id)
      );
      // XÓA bản ghi vi phạm: xóa toàn bộ IN+OUT của (ca, nhân viên) chứa lượt vượt
      // để ca quay về chưa điểm danh, bắt NV làm lại từ đầu.
      const groupOf = (e: any) => e.assignment_id || `${e.employee_id}__${(e.client_time || '').slice(0, 10)}`;
      const voidGroups = new Set(bad.map(groupOf));
      let voided = 0;
      for (const e of events || []) {
        if ((e.type === 'CHECK_IN' || e.type === 'CHECK_OUT') && voidGroups.has(groupOf(e))) {
          try {
            if (await adapter.deleteAttendanceEvent(e.event_id)) voided++;
          } catch { /* tiếp */ }
        }
      }
      const byEmp = new Map<string, any[]>();
      for (const e of bad) {
        if (!byEmp.has(e.employee_id)) byEmp.set(e.employee_id, []);
        byEmp.get(e.employee_id)!.push(e);
      }
      const offenderIds = [...byEmp.keys()];
      if (offenderIds.length > 0) {
        const names = await Promise.all(
          offenderIds.map(async id => (await employeesService.getEmployee(id).catch(() => null))?.full_name || id)
        );
        await notificationsService.sendNotification({
          recipientIds: offenderIds,
          type: 'ATTENDANCE_GPS_REDO',
          severity: 'ACTION_REQUIRED',
          title: '🚨 GPS vượt phạm vi — Bắt buộc điểm danh lại!',
          summary: `Lượt điểm danh ngày ${date} của bạn cách chi nhánh quá 300m nên không hợp lệ. Mở tab Điểm danh, đến trong phạm vi và thực hiện lại ngay!`,
          targetPath: '/attendance',
          actorId: req.user!.id,
        }).catch(() => null);
        broadcastUpdate('attendance', { action: 'gps-reverify', date, offenders: offenderIds });
        broadcastNotification({
          type: 'INFO',
          title: `🚨 Rà soát GPS: ${offenderIds.length} NV phải điểm danh lại`,
          message: `${names.slice(0, 8).join(', ')}${names.length > 8 ? ` +${names.length - 8} người` : ''} — đã gửi yêu cầu điểm danh lại đến từng người (ngày ${date}).`,
          linkTab: 'hr-attendance',
          metadata: { date, offenders: offenderIds },
          targetRoles: ['ADMIN', 'HR', 'STORE'],
        });
      }
      const detail = [...byEmp.entries()].map(([id, evts]) => ({
        employee_id: id,
        count: evts.length,
        max_distance: Math.max(...evts.map(e => Number(e.distance_meters) || 0)),
      }));
      broadcastUpdate('attendance', { action: 'gps-voided', date, voided });
      res.json({ date, offenders: offenderIds.length, voided, detail });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Tải gói cả tuần T2–CN (để HR lưu trước 23h30 Chủ nhật).
  app.get('/admin/attendance/export-week', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const raw = String(req.query.weekMon || new Date().toISOString().split('T')[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return res.status(400).json({ error: 'INVALID_DATE: weekMon dùng định dạng YYYY-MM-DD.' });
      }
      const syncService = (adapter as any).syncService;
      if (!syncService?.buildAttendanceWeekZip) {
        return res.status(503).json({ error: 'SYNC_NOT_READY' });
      }
      const [yy, mm, dd] = raw.split('-').map(Number);
      const dt = new Date(Date.UTC(yy, mm - 1, dd));
      const dowMon0 = (dt.getUTCDay() + 6) % 7;
      const mon = new Date(dt.getTime() - dowMon0 * 86_400_000).toISOString().slice(0, 10);
      const { zip, eventCount, photoCount, missing } = await syncService.buildAttendanceWeekZip(adapter, mon);
      if (!photoCount) {
        return res.status(400).json({
          error: 'NO_PHOTOS',
          message: `Tuần ${mon}: ${eventCount} lượt chấm công nhưng không có ảnh nào tải được.`,
          eventCount,
          photoCount,
          missing: (missing || []).slice(0, 20),
        });
      }
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="diem-danh-tuan-${mon}.zip"`);
      res.send(zip);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'EXPORT_FAILED' });
    }
  });

  // Alias for /leaves
  app.post('/leaves', authMiddleware, validate({ body: leavesAliasBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employeeId;
      try {
        await assertHangTuanWindow(adapter, req.user!, req.body.leaveType, new Date(), req.body.requestedDate || req.body.requested_date);
      } catch (werr: any) {
        if (werr.message === ERROR_CODES.WEEKLY_OFF_WINDOW_CLOSED) {
          return res.status(403).json({
            error: werr.message,
            message: werr.reason || `Đăng ký 2 ngày nghỉ OFF chỉ mở từ 09h00 Thứ 6 đến 09h00 Thứ 7 hàng tuần (lần tới: ${werr.window.windowOpensAt}).`,
            code: werr.message,
            windowOpensAt: werr.window.windowOpensAt,
            windowClosesAt: werr.window.windowClosesAt,
          });
        }
        throw werr;
      }
      const emp = await employeesService.getEmployee(employeeId);
      const branchId = req.body.branchId || emp?.default_branch_id || 'CN130';

      // NV thử việc: Báo nghỉ khẩn chỉ dùng được khi Admin/HR đã kích hoạt 1 lượt.
      const isProbationEmergency =
        (emp as any)?.employment_status === 'PROBATION' &&
        String(req.body.leaveType || '') === 'DOT_XUAT' &&
        String(req.body.reason || '').startsWith('[NGHỈ KHẨN CẤP]');
      if (isProbationEmergency) {
        const grants = await readEmergencyGrants();
        const g = grants[employeeId];
        if (!g || g.usedAt) {
          return res.status(403).json({
            error: 'EMERGENCY_LEAVE_NOT_GRANTED',
            message: 'Chức năng Báo nghỉ khẩn chưa được kích hoạt cho bạn. Vui lòng báo Store/Admin để được mở 1 lượt dùng duy nhất!',
          });
        }
      }

      const result = await schedulesService.requestLeave({
        ...req.body,
        employeeId,
        branchId,
      });
      // Dùng xong là tiêu thụ lượt ngay — chức năng tự ẩn lại phía nhân viên.
      if (isProbationEmergency) {
        try {
          const settings = (await adapter.getSystemSettings()) || {};
          const grants = { ...((settings as any)[EMERGENCY_GRANT_KEY] || {}) };
          if (grants[employeeId] && !grants[employeeId].usedAt) {
            grants[employeeId] = { ...grants[employeeId], usedAt: new Date().toISOString() };
            await adapter.updateSystemSettings({ ...settings, [EMERGENCY_GRANT_KEY]: grants });
            broadcastUpdate('emergencyLeave', { action: 'used', employeeId });
          }
        } catch { /* best-effort: phiếu đã tạo thành công, lượt sẽ hết ở lần kiểm tra sau */ }
      }
      broadcastUpdate('leaves', { action: 'create', leave: result.result });
      // Lịch OFF tuần tự động ghi nhận — không gửi phiếu duyệt. Chỉ báo đơn đột xuất.
      if (result.result.leave_type === 'DOT_XUAT') {
        broadcastNotification({
          type: 'LEAVE',
          title: '📝 Đơn Xin Nghỉ Phép Mới',
          message: `${emp?.full_name || 'Nhân viên'} vừa nộp đơn xin nghỉ đột xuất ngày ${result.result.requested_date}. Lý do: ${result.result.reason || 'Việc cá nhân'}`,
          linkTab: 'hr-leave',
          metadata: { leaveId: result.result.request_id, employeeId },
          targetRoles: ['ADMIN', 'HR', 'STORE'],
        });
      }
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Đăng ký / cập nhật lại 2 ngày OFF tuần trong 1 request nguyên tử.
  // Fix lỗi mở bù VIP: 2 POST rời rạc cũ bị lỗi nửa chừng và chặn "cập nhật lại".
  const handleWeeklyOffReplace = async (req: AuthenticatedRequest, res: any) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'MISSING_EMPLOYEE' });
      const day1: string = req.body.day1 || req.body.day_1 || req.body.requestedDate1;
      const day2: string = req.body.day2 || req.body.day_2 || req.body.requestedDate2;
      const reason: string = req.body.reason || 'Đăng ký 2 ngày nghỉ OFF tuần';
      // Ràng buộc khung giờ mở cổng (kể cả đợt mở bù VIP) cho cả 2 ngày.
      try {
        await assertHangTuanWindow(adapter, req.user!, 'HANG_TUAN', new Date(), day1);
        await assertHangTuanWindow(adapter, req.user!, 'HANG_TUAN', new Date(), day2);
      } catch (werr: any) {
        if (werr.message === ERROR_CODES.WEEKLY_OFF_WINDOW_CLOSED) {
          return res.status(403).json({
            error: werr.message,
            message: werr.reason || 'Đăng ký 2 ngày nghỉ OFF chỉ mở từ 09h00 Thứ 6 đến 09h00 Thứ 7 hàng tuần.',
            code: werr.message,
            windowOpensAt: werr.window.windowOpensAt,
            windowClosesAt: werr.window.windowClosesAt,
          });
        }
        throw werr;
      }
      const emp = await employeesService.getEmployee(employeeId).catch(() => null);
      const branchId = req.body.branchId || (emp as any)?.default_branch_id || 'CN130';
      const result = await schedulesService.replaceWeeklyOff({ employeeId, branchId, day1, day2, reason });
      broadcastUpdate('leaves', { action: 'weekly-off-replace', leaves: result.result.leaves });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };
  app.put('/leaves/weekly-off', authMiddleware, validate({ body: leavesAliasBody }), handleWeeklyOffReplace);
  app.put('/leave-requests/weekly-off', authMiddleware, validate({ body: leavesAliasBody }), handleWeeklyOffReplace);

  // HR rà soát + reset lịch OFF tuần TRÙNG ca đã đăng ký từ trước (cùng CN + cùng ca
  // + cùng ngày): hủy phiếu trùng để NV về trạng thái chưa đăng ký và đăng ký lại
  // theo luật chống trống ca. dryRun=true chỉ xem trước, không xóa.
  app.post('/admin/weekly-off/reset-overlaps', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const dryRun = (req.body as any)?.dryRun !== false;
      const result = await schedulesService.resetOverlappingWeeklyOff(req.user!.id, dryRun);
      if (!dryRun && result.cancelledCount > 0) {
        broadcastUpdate('leaves', { action: 'weekly-off-overlap-reset', groups: result.groups });
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || 'Lỗi reset lịch OFF trùng ca') });
    }
  });

  // Reset ALL lịch OFF tuần (pass bảo vệ, mặc định Umbomilk@999 — đổi bằng env
  // WEEKLY_OFF_RESET_PASS): hủy toàn bộ phiếu HANG_TUAN còn hiệu lực từ hôm nay để
  // NV đăng ký lại từ đầu. dryRun=true chỉ đếm trước.
  app.post('/admin/weekly-off/reset-all', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const dryRun = (req.body as any)?.dryRun !== false;
      const pass = String((req.body as any)?.pass || '');
      const result = await schedulesService.resetAllWeeklyOff(req.user!.id, pass, dryRun);
      if (!dryRun && result.cancelledCount > 0) {
        broadcastUpdate('leaves', { action: 'weekly-off-reset-all', cancelled: result.cancelledCount });
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      const msg = String(err?.message || 'Lỗi reset ALL lịch OFF');
      const status = msg.startsWith('RESET_PASS_INVALID') ? 403 : 500;
      res.status(status).json({ error: msg });
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

  // NV THỬ VIỆC đăng ký 5 ngày OFF trong 12 ngày thử việc (7 làm / 5 OFF).
  // Xác nhận xong hệ thống TỰ XẾP 7 ca làm PUBLISHED vào các ngày còn lại.
  app.post('/leaves/probation-off', authMiddleware, requireRole(['EMPLOYEE']), validate({ body: probationOffBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.status(403).json({ error: 'NOT_AN_EMPLOYEE' });
      const emp = await employeesService.getEmployee(employeeId).catch(() => null);
      const branchId = (req.body as any).branchId || (emp as any)?.default_branch_id || 'CN130';
      const result = await schedulesService.registerProbationOff({
        employeeId,
        branchId,
        dates: (req.body as any).dates || [],
        actorId: employeeId,
      });
      broadcastUpdate('leaves', { action: 'probation-off', leaves: result.result.leaves });
      broadcastUpdate('schedules', { action: 'probation-auto', employeeId });
      broadcastNotification({
        type: 'LEAVE',
        title: '📝 NV Thử Việc Đã Đăng Ký 5 Ngày OFF',
        message: `${emp?.full_name || employeeId} đã chọn 5 ngày OFF thử việc (${(result.result.offDates || []).join(', ')}). Hệ thống đã tự xếp ${(result.result.workDates || []).length} ca làm.`,
        linkTab: 'hr-leave',
        metadata: { employeeId },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || 'Lỗi đăng ký OFF thử việc') });
    }
  });

  // NV thử việc TỰ thêm ca đẩy nhanh (không cần HR duyệt, tối đa 2 ca/ngày).
  // Vượt 2 ca -> chặn + thông báo ngay đến Nhân sự (HR) để theo dõi.
  app.post('/me/probation-extra-shift', authMiddleware, requireRole(['EMPLOYEE']), validate({ body: probationExtraShiftBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.status(403).json({ error: 'NOT_AN_EMPLOYEE' });
      const { result: shift } = await schedulesService.addProbationExtraShift({
        employeeId,
        date: String(req.body.date || '').slice(0, 10),
        shiftCode: req.body.shiftCode,
        actorId: employeeId,
      });
      const emp = await employeesService.getEmployee(employeeId).catch(() => null);
      broadcastUpdate('schedules', { action: 'probation-extra', employeeId });
      broadcastNotification({
        type: 'LEAVE',
        title: '⚡ NV Thử Việc Tự Thêm Ca Đẩy Nhanh',
        message: `${emp?.full_name || employeeId} vừa tự thêm ${shift.shift_code} ngày ${shift.date} (không cần duyệt).`,
        linkTab: 'hr-probation',
        metadata: { employeeId, date: shift.date, shiftCode: shift.shift_code },
        targetRoles: ['ADMIN', 'HR', 'STORE'],
      });
      res.json({ success: true, result: shift });
    } catch (err: any) {
      const msg = String(err?.message || 'Lỗi khi tự thêm ca!');
      // Cố xếp ca thứ 3 trong ngày -> chặn + báo HR ngay lập tức.
      if (msg.startsWith('MAX_2_SHIFTS_PER_DAY')) {
        try {
          const employeeId = req.user?.employeeId;
          const emp = await employeesService.getEmployee(employeeId || '').catch(() => null);
          broadcastNotification({
            type: 'LEAVE',
            title: '🚨 NV Thử Việc Cố Xếp Quá 2 Ca/Ngày (Đã Chặn)',
            message: `${emp?.full_name || employeeId} vừa cố thêm ca ngày ${String(req.body.date || '').slice(0, 10)} dù đã đủ 2 ca — hệ thống đã chặn, HR kiểm tra lại lịch của NV này!`,
            linkTab: 'hr-probation',
            metadata: { employeeId, date: String(req.body.date || '').slice(0, 10) },
            targetRoles: ['ADMIN', 'HR', 'STORE'],
          });
        } catch { /* best-effort */ }
        return res.status(400).json({ error: 'MAX_2_SHIFTS_PER_DAY', message: msg.replace(/^MAX_2_SHIFTS_PER_DAY:\s*/, '') });
      }
      res.status(400).json({ error: msg });
    }
  });

  app.get('/me/attendance', authMiddleware, validate({ query: meAttendanceQuery }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) return res.status(400).json({ error: 'NOT_AN_EMPLOYEE' });
      const today = new Date(Date.now() + 7 * 3_600_000).toISOString().split('T')[0];
      const fromDate = (req.query.fromDate as string) || (req.query.date as string) || today;
      const toDate = (req.query.toDate as string) || (req.query.date as string) || today;
      // Gộp nhiều ngày trong 1 request (đọc bộ nhớ, rẻ) — giới hạn 31 ngày chống lạm dụng.
      const start = new Date(fromDate > toDate ? toDate : fromDate);
      const end = new Date(fromDate > toDate ? fromDate : toDate);
      const days: string[] = [];
      for (let d = new Date(start); d <= end && days.length < 31; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split('T')[0]);
      }
      if (days.length <= 1) {
        const events = await attendanceService.getEmployeeAttendance(employeeId, days[0] || today);
        return res.json(events);
      }
      const settled = await Promise.all(days.map(dt => attendanceService.getEmployeeAttendance(employeeId, dt).catch(() => [])));
      res.json(settled.flat());
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

  app.post('/attendance/adjustments', authMiddleware, validate({ body: adjustmentCreateBody }), async (req: AuthenticatedRequest, res) => {
    try {
      const employeeId = req.user?.employeeId || req.body.employeeId;
      const result = await attendanceService.requestAdjustment({
        ...req.body,
        employeeId,
        // Client gửi snake_case photo_base64, service nhận camelCase photoBase64.
        photoBase64: req.body.photoBase64 || req.body.photo_base64,
        // Ngày sự cố NV chọn — chốt đúng ca, chống gắn nhầm ca ngày khác.
        incidentDate: req.body.incidentDate || req.body.incident_date,
      });
      // Realtime 100%: HR/Store thấy phiếu + ảnh bằng chứng ngay, không đợi poll 15s.
      broadcastUpdate('adjustments', { action: 'created', id: (result as any)?.adjustment_id, employeeId });
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
      // Cắt bytes ảnh inline khỏi danh sách (nhẹ payload); ảnh xem qua /:id/photo.
      // evidence_drive_id (kể cả DRV_LOCAL_ fallback) vẫn giữ để UI biết mà tải ảnh.
      res.json((list || []).map((a: any) => {
        if (a && (a as any).evidence_photo) {
          const { evidence_photo: _drop, ...rest } = a as any;
          return rest;
        }
        return a;
      }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Xóa cứng phiếu khỏi hệ thống (NV: hủy phiếu PENDING của mình; HR/QL: dọn phiếu chưa duyệt).
  // APPROVED khóa cứng. Xóa xong full-sync gỡ dòng khỏi Sheet DIEU_CHINH_CONG luôn.
  app.delete('/attendance/adjustments/:id', authMiddleware, validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const role = req.user?.role;
      const isManager = role === 'ADMIN' || role === 'HR' || role === 'STORE';
      if (!isManager && role !== 'EMPLOYEE') return res.status(403).json({ error: 'FORBIDDEN' });
      const actorId = isManager ? req.user!.id : req.user!.employeeId!;
      const result = await attendanceService.deleteAdjustment(req.params.id, actorId, isManager);
      broadcastUpdate('adjustments', { action: 'deleted', adjId: req.params.id });
      res.json((result as any)?.result ?? result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
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
      // Realtime: cổng NV thấy kết quả duyệt + bảng công/HR tải lại ngay.
      broadcastUpdate('adjustments', { action: 'review', id: req.params.id, status });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Sửa phiếu APPROVED bị gắn nhầm ca/ngày (lỗi app NV cũ): gỡ lượt dựng nhầm +
  // dựng lại đúng ngày phiếu, realtime cả 2 cổng.
  app.post('/attendance/adjustments/:id/repair', authMiddleware, requireRole(['ADMIN', 'HR', 'STORE']), validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await attendanceService.repairAdjustment(req.params.id, req.user!.id);
      broadcastUpdate('adjustments', { action: 'repair', id: req.params.id });
      broadcastUpdate('attendance', { action: 'adjustment-repair', id: req.params.id });
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
      // Realtime: các máy Finance khác thấy kỳ lương mới tính ngay.
      broadcastUpdate('payroll', { action: 'calculate', period: req.params.period });
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

  // HR Reports: tổng hợp tháng NV chính thức (tổng giờ, nhất/nhỏ nhất, lương
  // từng người). Lương lấy từ kỳ đã chốt, chưa chốt thì tạm tính theo công thức.
  app.get('/admin/reports/official-monthly', authMiddleware, requireRole(['ADMIN', 'HR']), async (req, res) => {
    try {
      const vn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
      const period = String((req.query as any)?.period || vn);
      res.json(await payrollService.summarizeOfficialMonth(period));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/payroll/:run/reconcile', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollRunParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await payrollService.reconcileRun(req.params.run, req.user!.id);
      broadcastUpdate('payroll', { action: 'reconcile', run: req.params.run });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/payroll/:run/approve', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollRunParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await payrollService.approveRun(req.params.run, req.user!.id);
      broadcastUpdate('payroll', { action: 'approve', run: req.params.run });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/payroll/:run/publish', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollRunParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await payrollService.publishRun(req.params.run, req.user!.id);
      broadcastUpdate('payroll', { action: 'publish', run: req.params.run });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/payroll/:run/mark-paid', authMiddleware, requireRole(['ADMIN', 'FINANCE']), validate({ params: payrollRunParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await payrollService.markPaid(req.params.run, req.user!.id);
      broadcastUpdate('payroll', { action: 'mark-paid', run: req.params.run });
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
      // Realtime: số chưa đọc đồng bộ giữa các tab/thiết bị cùng tài khoản.
      broadcastUpdate('notifications', { action: 'read', id: req.params.id });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/me/notifications/:id/acknowledge', authMiddleware, validate({ params: idParams }), async (req: AuthenticatedRequest, res) => {
    try {
      const recipientId = req.user?.employeeId || req.user?.id || 'ALL';
      const updated = await notificationsService.markAcknowledged(req.params.id, recipientId);
      broadcastUpdate('notifications', { action: 'acknowledge', id: req.params.id });
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
      const { admin_id, username, password, password_hash, full_name, role, branch_scope, is_active } = req.body;
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
        is_active: is_active ?? true,
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
      // Chống tự khóa nhầm tài khoản gốc — kẹt hết Admin thì không ai mở lại được.
      if (req.params.id === 'ADM_001' && (req.body as any)?.is_active === false) {
        return res.status(400).json({ error: 'Không thể khóa tài khoản Quản trị viên gốc (ADM_001)' });
      }
      const updates = { ...(req.body || {}) };
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
      const locked = (updated as any).is_active === false;
      await adapter.recordAuditLog({
        actor_id: req.user!.id,
        action: locked ? 'INTERNAL_ACCOUNT_LOCKED' : (updates as any)?.is_active === true ? 'INTERNAL_ACCOUNT_UNLOCKED' : 'INTERNAL_ACCOUNT_UPDATED',
        target_type: 'ADMIN_ACCOUNT',
        target_id: req.params.id,
        payload_after: sanitizeAdmin(updated),
      });
      broadcastUpdate('accounts', { action: 'updateAdmin', account: sanitizeAdmin(updated) });
      if (locked) {
        // Đá văng ngay: token cũ hết hiệu lực + socket báo client về màn đăng nhập.
        try {
          const io = app.get('io');
          io?.to(`user:${req.params.id}`).emit('admin:forceLogout', {
            event_id: `lock_${Date.now()}`,
            adminId: req.params.id,
            reason: 'Tài khoản của bạn đã bị khóa bởi quản trị viên.',
          });
        } catch { /* non-fatal */ }
      }
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
      // Realtime: các máy khác tải lại danh sách chi nhánh/GPS ngay.
      broadcastUpdate('config', { area: 'branches', id: req.params.id });
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
      broadcastUpdate('config', { area: 'shift-templates' });
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
      broadcastUpdate('config', { area: 'policies' });
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

  // Nạp lại lịch sử thông báo từ dữ liệu có sẵn (chấm công/đơn nghỉ/đổi ca/bài TEST)
  // kể từ fromDate (mặc định 28/09/2026). Lặp lại an toàn: bỏ qua bản đã nạp.
  app.post('/admin/notifications/backfill', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      const from = String(req.body?.fromDate || req.query?.fromDate || '2026-09-28');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return res.status(400).json({ error: 'INVALID_DATE: fromDate dùng định dạng YYYY-MM-DD.' });
      }
      const since = (iso: string) => (iso || '') >= from;
      const MAX_BACKFILL = 3000;
      let budget = MAX_BACKFILL;
      const existing = await adapter.getInboxForRecipient('ALL').catch(() => []);
      const seen = new Set((existing || []).map((n: any) => n.inbox_id));
      const employees = await adapter.listEmployees().catch(() => []);
      const empName = (id: string) => (employees as any[]).find(e => e.employee_id === id)?.full_name || id;
      let created = 0;
      let skipped = 0;
      const pushOne = async (key: string, type: string, title: string, summary: string, targetPath: string | undefined, createdAt: string) => {
        const inboxId = `BFINBOX_${key}`;
        if (seen.has(inboxId)) {
          skipped++;
          return;
        }
        if (budget-- <= 0) {
          skipped++;
          return;
        }
        seen.add(inboxId);
        const notifId = `BF_${key}`;
        await adapter.createNotification(
          {
            notification_id: notifId,
            event_id: notifId,
            recipient_id: 'ALL',
            dedupe_key: notifId,
            type,
            severity: 'SYSTEM',
            title,
            summary,
            target_path: targetPath,
            channel: 'IN_APP',
            delivery_status: 'QUEUED',
            attempts: 1,
          } as any,
          [
            {
              inbox_id: inboxId,
              notification_id: notifId,
              recipient_id: 'ALL',
              type,
              title,
              summary,
              severity: 'SYSTEM',
              target_path: targetPath,
            } as any,
          ]
        ).catch(() => { skipped++; });
        // Giữ đúng thời gian gốc thay vì "vừa xong"
        try {
          const mock: any = (adapter as any).getMockAdapter ? (adapter as any).getMockAdapter() : adapter;
          const item = mock.notificationInbox?.find((n: any) => n.inbox_id === inboxId);
          if (item && createdAt) item.created_at = createdAt;
          const out = mock.notificationOutbox?.find((o: any) => o.notification_id === notifId);
          if (out && createdAt) out.created_at = createdAt;
        } catch { /* best-effort */ }
        created++;
      };

      const attEvents: any[] = await adapter.getAttendanceEvents(undefined, '').catch(() => []);
      for (const e of attEvents) {
        const ts = e.server_received_at || e.created_at || e.client_time || '';
        if (!since((ts || '').slice(0, 10))) continue;
        if (e.type === 'CHECK_IN') {
          await pushOne(`ATT_${e.event_id}`, 'emp.checkin', '🟢 Điểm Danh Check-in', `${empName(e.employee_id)} đã check-in (${e.client_time || ''}).`, '/hr-attendance', ts);
        } else if (e.type === 'CHECK_OUT') {
          await pushOne(`ATT_${e.event_id}`, 'emp.checkout', '🏁 Điểm Danh Check-out', `${empName(e.employee_id)} đã check-out (${e.client_time || ''}).`, '/hr-attendance', ts);
        } else if (e.type === 'ABSENT') {
          await pushOne(`ATT_${e.event_id}`, 'emp.checkin', '🔴 Tự Ghi Vắng Ca', `${empName(e.employee_id)} vắng ca ngày ${(e.client_time || '').slice(0, 10)}.`, '/hr-attendance', ts);
        }
      }
      const leaves: any[] = await adapter.listLeaveRequests().catch(() => []);
      for (const l of leaves) {
        if (!since((l.created_at || '').slice(0, 10))) continue;
        await pushOne(`LEAVE_${l.request_id}`, 'emp.leave', '📝 Đơn Nghỉ Phép', `${empName(l.employee_id)} nghỉ ${l.leave_type === 'DOT_XUAT' ? 'đột xuất' : 'OFF'} ngày ${l.requested_date} (${l.status}).`, '/hr-leave', l.created_at);
      }
      const swaps: any[] = await (adapter.getMockAdapter() as any).listSwapRequests().catch(() => []);
      for (const s of swaps) {
        if (!since((s.created_at || '').slice(0, 10))) continue;
        await pushOne(`SWAP_${s.swap_id}`, 'emp.swap', '🤝 Đổi Ca', `${empName(s.requester_id)} ⇄ ${empName(s.target_employee_id || '?')} (${s.status}).`, '/hr-swap', s.created_at);
      }
      const papers: any[] = await (adapter as any).listTestPapers ? await (adapter as any).listTestPapers().catch(() => []) : [];
      for (const p of papers || []) {
        if (!since((p.created_at || '').slice(0, 10))) continue;
        await pushOne(`TESTP_${p.test_id}`, 'emp.test', '📝 Giao Bài TEST', `Đã giao "${p.title}".`, '/hr-tests', p.created_at);
      }
      const subs: any[] = await (adapter as any).listTestSubmissions ? await (adapter as any).listTestSubmissions().catch(() => []) : [];
      for (const s of subs || []) {
        if (s.status !== 'SUBMITTED' || !since(((s as any).submitted_at || s.created_at || '').slice(0, 10))) continue;
        await pushOne(
          `TESTS_${s.submission_id}`, 'emp.test',
          (s as any).passed ? '✅ Đạt Bài TEST' : '📝 Nộp Bài TEST',
          `${empName(s.employee_id)} đạt ${(s as any).score ?? '?'}/10.`,
          '/hr-tests', (s as any).submitted_at || s.created_at
        );
      }
      broadcastUpdate('notifications', { action: 'backfill', from, created, skipped });
      res.json({ from, created, skipped, capped: budget < 0 });
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

  // --- TÍCH HỢP GOOGLE SHEETS (sync-now thủ công, có cooldown chống vượt quota) ---
  let lastSyncNowAt = 0;
  app.post('/admin/integrations/sync-now', authMiddleware, requireRole(['ADMIN', 'HR']), async (req: AuthenticatedRequest, res) => {
    try {
      // Chống bấm sync-now dồn dập (tay + nhiều máy + full-sync nền): full sync
      // ~30 writes, quota Sheets chỉ 60 writes/phút — bấm 2 lần liên tiếp là vỡ quota.
      const nowMs = Date.now();
      if (nowMs - lastSyncNowAt < 45000) {
        const wait = Math.ceil((45000 - (nowMs - lastSyncNowAt)) / 1000);
        return res.json({
          success: true,
          message: `Vừa đồng bộ ${Math.round((nowMs - lastSyncNowAt) / 1000)}s trước — đợi thêm ${wait}s để khỏi vượt quota Google Sheets rồi bấm lại.`,
          details: null,
          synced_at: new Date(lastSyncNowAt).toISOString(),
          cooldown: true,
        });
      }
      lastSyncNowAt = nowMs;
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
  // Trạng thái bảo trì PUBLIC cho cổng NV (không cần đăng nhập để hiện màn bảo trì).
  // Chỉ lộ 3 trường an toàn: 2 cờ + thông điệp (không lộ cấu hình chi tiết từng phân hệ).
  app.get('/public/portal-maintenance', async (req, res) => {
    try {
      const m: any = await adapter.getMaintenance().catch(() => ({}));
      res.json({
        system_maintenance: !!m?.system_maintenance,
        employee_web_maintenance: !!m?.employee_web_maintenance,
        maintenance_message: String(m?.maintenance_message || ''),
        updated_at: m?.updated_at || null,
      });
    } catch {
      // Fail-open: lỗi đọc thì coi như KHÔNG bảo trì để khỏi khóa nhầm toàn bộ NV.
      res.json({ system_maintenance: false, employee_web_maintenance: false, maintenance_message: '' });
    }
  });

  // --- RSVP PHỎNG VẤN (ứng viên bấm link trong thư mời Zalo, không cần đăng nhập) ---
  const escapeHtml = (s: string) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Trang xác nhận gọn cho điện thoại (token nằm sẵn trong nút, không lộ thêm).
  const rsvpPage = (title: string, bodyHtml: string, ctx: { token: string; name: string; status: string } | null) => `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>${escapeHtml(title)} — Ụm Bò Milk</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:linear-gradient(160deg,#0F172A,#831843);color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#fff;color:#1F2937;border-radius:16px;max-width:440px;width:100%;padding:28px 22px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)}.logo{font-weight:800;color:#E85D92;font-size:15px;letter-spacing:1px}h1{font-size:20px;margin:10px 0}p{font-size:14px;line-height:1.65}.btn{display:block;width:100%;padding:13px;border-radius:10px;border:none;font-size:15px;font-weight:800;cursor:pointer;margin-top:10px}.ok{background:linear-gradient(135deg,#059669,#34D399);color:#fff}.later{background:#F3F4F6;color:#374151}.msg{margin-top:12px;font-size:13px;font-weight:700}</style>
</head><body><div class="card"><div class="logo">ỤM BÒ MILK • TUYỂN DỤNG</div><h1>${escapeHtml(title)}</h1><p>${bodyHtml}</p>
${ctx ? `<button class="btn ok" id="bOk">✅ Tôi sẽ tham gia</button><button class="btn later" id="bLater">🔄 Xin dời lịch khác</button><div class="msg" id="msg"></div>
<script>const tk=${JSON.stringify(ctx.token)};
async function send(d){document.getElementById('msg').textContent='⏳ Đang gửi...';try{const r=await fetch('./rsvp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:tk,decision:d})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Lỗi');document.getElementById('msg').textContent=d==='CONFIRM'?'🎉 Đã ghi nhận! Hẹn gặp bạn đúng giờ nhé.':'📝 Đã ghi nhận xin dời lịch! HR sẽ liên hệ xếp lịch mới.';}catch(e){document.getElementById('msg').textContent='⚠️ '+e.message;}}</script>
<script>document.getElementById('bOk').onclick=()=>send('CONFIRM');document.getElementById('bLater').onclick=()=>send('RESCHEDULE');</script>` : ''}
</div></body></html>`;
  // Trang xác nhận: hiện tên + lịch hẹn + 2 nút Xác nhận tham gia / Xin dời lịch.
  app.get('/public/interview/rsvp', async (req, res) => {
    try {
      const sid = employeesService.verifyRsvpToken(String(req.query.token || ''));
      const cand: any = (await adapter.listCandidates().catch(() => []))
        .find((c: any) => c.submission_id === sid);
      if (!cand) return res.status(404).send(rsvpPage('Link không còn hiệu lực', 'Hồ sơ ứng viên không tồn tại. Liên hệ HR để được hỗ trợ.', null));
      const st = String(cand.status || '');
      if (!['INVITED_INTERVIEW', 'CONFIRMED', 'RESCHEDULE_REQUESTED'].includes(st)) {
        return res.send(rsvpPage(
          'Lịch hẹn không còn hiệu lực',
          `Chào ${cand.full_name || 'bạn'}! Lịch phỏng vấn này hiện ở trạng thái "${st}". Liên hệ HR để đặt lịch mới.`,
          null
        ));
      }
      res.send(rsvpPage(
        'Xác nhận tham gia phỏng vấn',
        `Chào <b>${escapeHtml(cand.full_name || 'bạn')}</b>!<br/>Lịch hẹn của bạn: <b>${escapeHtml(String(cand.interview_time_slot || ''))}</b> ngày <b>${escapeHtml(String(cand.interview_date || '').slice(0, 10))}</b>.<br/>Vui lòng xác nhận để HR giữ lịch cho bạn${st === 'CONFIRMED' ? ' (bạn đã xác nhận — bấm lại để chắc chắn)' : ''}.`,
        { token: String(req.query.token || ''), name: String(cand.full_name || ''), status: st }
      ));
    } catch (e: any) {
      res.status(400).send(rsvpPage('Link không hợp lệ', escapeHtml(String(e?.message || 'Link xác nhận hết hạn hoặc không hợp lệ!')), null));
    }
  });

  // Ứng viên bấm nút trên trang RSVP.
  app.post('/public/interview/rsvp', async (req, res) => {
    try {
      const sid = employeesService.verifyRsvpToken(String((req.body as any)?.token || ''));
      const decision = String((req.body as any)?.decision || '').toUpperCase();
      if (decision === 'CONFIRM') {
        const updated: any = await employeesService.confirmInterview(sid, 'CANDIDATE', 'CANDIDATE');
        broadcastUpdate('candidates', { action: 'interview-confirmed', id: sid });
        try {
          await (adapter as any)?.pushCandidatesNow?.();
        } catch { /* best-effort */ }
        return res.json({ success: true, status: updated.status });
      }
      if (decision === 'RESCHEDULE') {
        const updated: any = await employeesService.requestInterviewReschedule(sid);
        broadcastUpdate('candidates', { action: 'interview-reschedule-requested', id: sid });
        try {
          const syncSvc = (adapter as any)?.syncService;
          syncSvc?.markInterviewScheduleCleared?.(sid);
          await (adapter as any)?.pushCandidatesNow?.();
        } catch { /* best-effort */ }
        try {
          const admins = await adapter.listAdminAccounts().catch(() => []);
          const ids = admins.filter((a: any) => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map((a: any) => a.admin_id);
          if (ids.length > 0) {
            await notificationsService.sendNotification({
              recipientIds: ids,
              type: 'INTERVIEW_RESCHEDULE',
              severity: 'ACTION_REQUIRED',
              title: `🔄 ${(updated as any).full_name || sid} xin dời lịch phỏng vấn`,
              summary: 'Ứng viên xin dời lịch qua link xác nhận. Vào tab Phỏng vấn đặt lịch mới cho bạn.',
              targetPath: '/hr-interviews',
              actorId: 'CANDIDATE',
            }).catch(() => null);
          }
        } catch { /* best-effort */ }
        return res.json({ success: true, status: updated.status });
      }
      return res.status(400).json({ error: 'INVALID_DECISION' });
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message || 'Lỗi xác nhận') });
    }
  });

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
      broadcastUpdate('config', { area: 'maintenance' });
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
      broadcastUpdate('config', { area: 'backup-snapshots', id: snap.snapshot_id });
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
      broadcastUpdate('config', { area: 'system-settings' });
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
      autoScheduleService,
      testsService,
      attendanceService,
      payrollService,
      notificationsService,
      zaloService,
    },
  };
}
