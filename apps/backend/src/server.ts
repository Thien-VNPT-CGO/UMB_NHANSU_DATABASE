import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { AuthService } from './services/auth.service.js';
import { weeklyOffScheduler } from './services/weekly-off.service.js';
import { pinRotationTick } from './services/pin-rotation.service.js';
import { dedupeDuplicateInterviews, enforceScreeningOutcomes } from './services/interview-dedupe.service.js';
import { interviewNoShowTick, interviewReminderTick } from './services/interview-reminders.service.js';
import { autoRemindersTick } from './services/auto-reminders.service.js';
import { buildSocketCorsOptions, getAllowedOrigins } from './config/security.js';

const PORT = process.env.PORT || 4005;

const { app, services, adapter } = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: buildSocketCorsOptions(),
});

// Attach io to express app for route broadcasting
app.set('io', io);

// Pass io to services
services.accountsService.setSocketServer(io);
services.schedulesService.setSocketServer(io);
(services as any).autoScheduleService?.setSocketServer?.(io);
(services as any).testsService?.setSocketServer?.(io);
services.attendanceService.setSocketServer(io);
services.payrollService.setSocketServer(io);
services.notificationsService.setSocketServer(io);

// Socket.IO authentication and room management (có kiểm tra revoke qua DB)
const socketAuth = new AuthService(adapter);
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token || typeof token !== 'string') {
    return next(new Error('AUTHENTICATION_ERROR: Missing token'));
  }

  socketAuth
    .verifyAccessToken(token)
    .then(decoded => {
      (socket as any).user = decoded;
      next();
    })
    .catch(() => {
      next(new Error('AUTHENTICATION_ERROR: Invalid token'));
    });
});

io.on('connection', socket => {
  const user = (socket as any).user;
  const userId = user.employeeId || user.sub;

  // Join personal user room
  socket.join(`user:${userId}`);

  // Join branch room if scoped
  if (user.branchScope && user.branchScope !== '*') {
    socket.join(`branch:${user.branchScope}`);
  }

  // Join role room
  if (user.role) {
    socket.join(`role:${user.role}`);
  }

  socket.on('disconnect', () => {
    // disconnected
  });
});

server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`ỤM BÒ MILK HR SYSTEM V5.1 - BACKEND SERVER STARTED`);
  console.log(`Port: ${PORT}`);
  console.log(`CORS origins: ${getAllowedOrigins().join(', ') || '(none — set CORS_ORIGINS in production)'}`);
  console.log(`Google Sheets Mode: ${adapter.getStatus().mode}`);
  console.log(`Realtime Socket.IO: Ready`);
  console.log(`Weekly-OFF gate: Fri 09:00 -> Sat 09:00 (VN) + reminder 5 min before`);
  console.log(`====================================================`);

  // Scheduler nhắc mở cổng đăng ký OFF tuần (mỗi 60s + ngay khi boot).
  const weeklyOffTick = () => {
    weeklyOffScheduler
      .tick(adapter, services.notificationsService)
      .catch(err => console.warn('[weekly-off] tick failed:', err?.message || err));
  };
  weeklyOffTick();
  setInterval(weeklyOffTick, 60_000);

  // Background Auto-Sync Worker: Tự động kéo toàn bộ dữ liệu từ Google Sheets mỗi 15 giây
  // và phát tín hiệu realtime qua Socket.IO tới toàn bộ ứng dụng web khi có dữ liệu thay đổi.
  let lastSyncSignature = '';
  const autoPullSheetsTick = async () => {
    try {
      const syncService = (adapter as any).syncService;
      if (syncService && syncService.getStatus().isConfigured) {
        const pullRes = await syncService.pullAllDataFromGoogleSheets(adapter);
        if (pullRes && pullRes.success && pullRes.counts) {
          const currentSignature = JSON.stringify(pullRes.counts);
          if (lastSyncSignature && lastSyncSignature !== currentSignature) {
            console.log('🔄 [Sheets Auto-Sync] Dữ liệu Google Sheets có thay đổi, đã tự động nạp lên hệ thống:', pullRes.counts);
            io.emit('data:updated', { entity: 'all', data: pullRes.counts, timestamp: new Date().toISOString() });
          }
          lastSyncSignature = currentSignature;
        }
      }
    } catch (err: any) {
      console.warn('[sheets-auto-pull] tick error:', err?.message || err);
    }
  };

  // Kéo dữ liệu tự động ngay sau khi khởi động 2 giây
  setTimeout(autoPullSheetsTick, 2000);
  // Định kỳ tự động quét và kéo dữ liệu mới từ Google Sheets mỗi 10 giây
  const syncIntervalMs = Number(process.env.SHEETS_SYNC_INTERVAL_MS) || 10_000;
  setInterval(autoPullSheetsTick, syncIntervalMs);

  // Nhắc việc tự động mỗi 5 phút: check-in Zalo trước ca, PIN quá hạn, đơn tồn duyệt.
  const autoRemindersTickSafe = () => {
    autoRemindersTick(adapter, services.notificationsService, services.zaloService).catch(err =>
      console.warn('[auto-reminders] tick error:', err?.message || err)
    );
  };
  setTimeout(autoRemindersTickSafe, 60_000); // đợi dữ liệu load xong lần đầu
  setInterval(autoRemindersTickSafe, 5 * 60_000);

  // Phiếu bổ sung công gửi HR quá 30 phút chưa duyệt: tự động TỪ CHỐI (giữ phiếu
  // để đối soát) + báo inbox NV; phiếu đã tự từ chối quá 7 ngày nữa thì tự XÓA.
  // Chạy mỗi 1 phút để bám sát hiệu lực 30 phút của phiếu.
  const adjustmentExpiryTickSafe = async () => {
    try {
      const r = await services.attendanceService.expireStaleAdjustments(new Date());
      if (r.rejected.length > 0) {
        console.log(`[adjustments] Tự từ chối ${r.rejected.length} phiếu quá 30 phút HR chưa duyệt.`);
        for (const item of r.rejected) {
          try {
            await services.notificationsService.sendNotification({
              recipientIds: [item.employeeId],
              type: 'ADJUSTMENT_AUTO_REJECTED',
              severity: 'ACTION_REQUIRED',
              title: '⏳ Phiếu bổ sung công quá 30 phút chưa được duyệt',
              summary: 'HR chưa duyệt phiếu của bạn sau 30 phút nên hệ thống đã tự động từ chối. Cần thì gửi lại phiếu mới hoặc báo trực tiếp Store/HR!',
              targetPath: '/adjustment',
              actorId: 'SYSTEM',
            }).catch(() => null);
          } catch { /* best-effort từng người */ }
        }
        try {
          io.emit('data:updated', { entity: 'adjustments', data: { action: 'auto-rejected', ids: r.rejected.map(x => x.adjustmentId) }, timestamp: new Date().toISOString() });
        } catch { /* non-fatal */ }
      }
      if (r.deleted.length > 0) {
        console.log(`[adjustments] Tự xóa ${r.deleted.length} phiếu đã tự từ chối quá 7 ngày.`);
        try {
          io.emit('data:updated', { entity: 'adjustments', data: { action: 'auto-deleted', ids: r.deleted }, timestamp: new Date().toISOString() });
        } catch { /* non-fatal */ }
      }
    } catch (err: any) {
      console.warn('[adjustments] expiry tick error:', err?.message || err);
    }
  };
  setTimeout(adjustmentExpiryTickSafe, 60_000);
  setInterval(adjustmentExpiryTickSafe, 60_000);

  // Tự ghi VẮNG: ca PUBLISHED qua giờ kết thúc 30p mà không check-in -> bản ghi
  // ABSENT làm chứng cứ (đỏ trên 2 cổng, đồng bộ Sheets). Chạy mỗi 15 phút.
  const absenteeTickSafe = async () => {
    try {
      const r = await services.attendanceService.markAbsentees(new Date(), 30);
      if (r.marked > 0) {
        console.log(`[absentee] Đã ghi vắng ${r.marked} ca (quét ${r.checked}).`);
        try {
          io.emit('data:updated', { entity: 'attendance', data: { action: 'absent-marked', ...r }, timestamp: new Date().toISOString() });
        } catch { /* non-fatal */ }
      }
    } catch (err: any) {
      console.warn('[absentee] tick error:', err?.message || err);
    }
  };
  setTimeout(absenteeTickSafe, 120_000); // sau pull đầu
  setInterval(absenteeTickSafe, 15 * 60_000);

  // Tuần chấm công T2–CN: CN 20h00 nhắc HR tải trước 23h30, 23h30 tự lưu trữ
  // (ZIP tuần lên Drive + chuyển dòng sang tab LUUTRU + reset bảng realtime sang tuần mới),
  // T2 00h05 chạy dự phòng nếu lúc 23h30 server ngủ. Mỗi mốc chạy 1 lần/tuần.
  const weeklyDone = new Set<string>();
  const vnParts = (d: Date) => {
    const vn = new Date(d.getTime() + 7 * 3_600_000);
    return { dowSun0: vn.getUTCDay(), hh: vn.getUTCHours(), mm: vn.getUTCMinutes(), dateStr: vn.toISOString().slice(0, 10) };
  };
  const mondayOf = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d);
    const dt = new Date(t);
    const back = (dt.getUTCDay() + 6) % 7;
    return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
  };
  const attendanceWeekTick = async () => {
    try {
      const now = new Date();
      const { dowSun0, hh, mm } = vnParts(now);
      const syncService = (adapter as any).syncService;
      if (!syncService?.archiveAttendanceWeek) return;
      // CN 20h00: nhắc HR tải ZIP tuần trước 23h30
      if (dowSun0 === 0 && hh === 20 && mm < 2) {
        const key = `remind:${vnParts(now).dateStr}`;
        if (!weeklyDone.has(key)) {
          weeklyDone.add(key);
          const admins = await adapter.listAdminAccounts().catch(() => []);
          const ids = admins.filter(a => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map(a => a.admin_id);
          if (ids.length > 0) {
            await services.notificationsService.sendNotification({
              recipientIds: ids,
              type: 'ATTENDANCE_WEEK_EXPORT',
              severity: 'ACTION_REQUIRED',
              title: '⏰ Tải điểm danh tuần trước 23h30 tối nay',
              summary: '23h30 hệ thống tự lưu trữ + reset bảng realtime sang tuần mới. HR tải ZIP tuần (tab Chấm công → Tải ZIP tuần) để lưu máy.',
              actorId: 'SYSTEM',
            }).catch(() => null);
          }
        }
        return;
      }
      // CN 23h30: lưu trữ + reset
      if (dowSun0 === 0 && hh === 23 && mm >= 30 && mm < 32) {
        const weekMon = mondayOf(vnParts(now).dateStr);
        const key = `archive:${weekMon}`;
        if (!weeklyDone.has(key)) {
          weeklyDone.add(key);
          const r = await syncService.archiveAttendanceWeek(adapter, weekMon).catch((e: any) => ({ archived: false, reason: e?.message }));
          console.log(`[attendance-week] Archive tuần ${weekMon}:`, JSON.stringify(r));
          try {
            io.emit('data:updated', { entity: 'attendance', data: { action: 'week-archived', weekMon, ...r }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
        return;
      }
      // T2 00h05: dự phòng nếu CN 23h30 server ngủ
      if (dowSun0 === 1 && hh === 0 && mm >= 5 && mm < 7) {
        const ymd = vnParts(now).dateStr;
        const [y, m, d] = ymd.split('-').map(Number);
        const lastSun = new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
        const weekMon = mondayOf(lastSun);
        const key = `archive:${weekMon}`;
        if (!weeklyDone.has(key)) {
          weeklyDone.add(key);
          const r = await syncService.archiveAttendanceWeek(adapter, weekMon).catch((e: any) => ({ archived: false, reason: e?.message }));
          console.log(`[attendance-week] Archive bù tuần ${weekMon}:`, JSON.stringify(r));
        }
      }
    } catch (err: any) {
      console.warn('[attendance-week] tick error:', err?.message || err);
    }
  };
  setInterval(attendanceWeekTick, 60_000);

  // Tự tính nháp lương cuối tháng (Kế toán kiểm tra rồi duyệt tay):
  // 00h10 ngày mùng 1 HẰNG THÁNG: tự chạy công thức Excel cho tháng vừa qua,
  // tạo đúng 1 kỳ DRAFT (tháng đã có kỳ thì bỏ qua, không tính trùng).
  // Kế toán vào tab 5 kiểm tra B4 → sang tab 4 Đối soát/Duyệt/Phát hành.
  const payrollAutoDone = new Set<string>();
  const payrollAutoTick = async () => {
    try {
      const now = new Date();
      const { hh, mm, dateStr } = vnParts(now);
      if (dateStr.slice(8, 10) !== '01') return; // chỉ mùng 1
      if (hh !== 0 || mm < 10 || mm >= 30) return; // cửa sổ 00h10–00h30
      const [y, m] = dateStr.split('-').map(Number);
      const prev = new Date(Date.UTC(y, m - 1, 1) - 86_400_000);
      const period = prev.toISOString().slice(0, 7);
      const key = `payroll-auto:${period}`;
      if (payrollAutoDone.has(key)) return;
      payrollAutoDone.add(key);
      const existing = await adapter.listPayrollRuns().catch(() => []);
      if ((existing || []).some((r: any) => String((r as any).period) === period)) {
        console.log(`[payroll-auto] Kỳ ${period} đã có — bỏ qua tính nháp tự động.`);
        return;
      }
      const res: any = await services.payrollService
        .calculateFormulaPayroll(period, '*', 'SYSTEM')
        .catch((e: any) => ({ error: e?.message || String(e) }));
      if (res?.error) {
        console.warn(`[payroll-auto] Tính nháp kỳ ${period} thất bại:`, res.error);
        return;
      }
      const run = res?.run ?? res;
      console.log(`[payroll-auto] Đã tự tính nháp kỳ ${period}: ${run?.total_employees ?? '?'} NV, thực lãnh ${Number(run?.total_amount || 0).toLocaleString('vi-VN')}đ.`);
      const admins = await adapter.listAdminAccounts().catch(() => []);
      const ids = (admins || [])
        .filter((a: any) => ['ADMIN', 'FINANCE'].includes(a.role) && a.is_active !== false)
        .map((a: any) => a.admin_id);
      if (ids.length > 0) {
        await services.notificationsService.sendNotification({
          recipientIds: ids,
          type: 'PAYROLL_AUTO_DRAFT',
          severity: 'ACTION_REQUIRED',
          title: `🤖 Đã tự tính nháp lương tháng ${period.slice(5, 7)}/${period.slice(0, 4)}`,
          summary: `Hệ thống tự chạy công thức Excel lúc 00h10 mùng 1: ${run?.total_employees ?? '?'} NV, thực lãnh ${Number(run?.total_amount || 0).toLocaleString('vi-VN')}đ. Kế toán kiểm tra tab Tính lương (B4) rồi Đối soát/Duyệt/Phát hành.`,
          actorId: 'SYSTEM',
        }).catch(() => null);
      }
      try {
        io.emit('data:updated', { entity: 'payroll', data: { action: 'auto-draft', period, runId: run?.run_id }, timestamp: new Date().toISOString() });
      } catch { /* non-fatal */ }
    } catch (err: any) {
      console.warn('[payroll-auto] tick error:', err?.message || err);
    }
  };
  setInterval(payrollAutoTick, 5 * 60_000);

  // Reset thông báo cổng quản trị 6h00 HẰNG NGÀY (1 lần/ngày): xóa bản ghi cũ hơn
  // 00h00 cùng ngày trong bộ nhớ (tab Sheets THONGBAO_NV giữ nguyên, cập nhật liên tục).
  const notifResetDone = new Set<string>();
  const notifResetTick = async () => {
    try {
      const vn = new Date(Date.now() + 7 * 3_600_000);
      if (vn.getUTCHours() < 6) return; // chỉ sau 6h sáng
      const today = vn.toISOString().slice(0, 10);
      const key = `notif-reset:${today}`;
      if (notifResetDone.has(key)) return;
      notifResetDone.add(key);
      // Mốc 00h00 hôm nay giờ VN (quy về UTC để so chuỗi ISO cho đúng)
      const [yy, mm, dd] = today.split('-').map(Number);
      const cutoff = new Date(Date.UTC(yy, mm - 1, dd) - 7 * 3_600_000).toISOString();
      const removed = await adapter.pruneNotifications(cutoff).catch(() => 0);
      console.log(`[notifications] Reset hằng ngày ${today}: đã xóa ${removed} thông báo cũ (Sheets giữ nguyên).`);
      try {
        io.emit('data:updated', { entity: 'notifications', data: { action: 'daily-reset', today, removed }, timestamp: new Date().toISOString() });
      } catch { /* non-fatal */ }
    } catch (err: any) {
      console.warn('[notifications] reset tick error:', err?.message || err);
    }
  };
  setInterval(notifResetTick, 5 * 60_000);

  // Xoay PIN định kỳ hàng tháng (ngày 1-5): cấp PIN mới theo mẻ, báo NV + HR/Admin.
  const pinRotationTickSafe = () => {
    pinRotationTick(adapter, services.notificationsService)
      .then(prog => {
        if (prog && !prog.completed) {
          try {
            io.emit('data:updated', { entity: 'accounts', data: { action: 'pin-rotation', ...prog }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch(err => console.warn('[pin-rotation] tick error:', err?.message || err));
  };
  setTimeout(pinRotationTickSafe, 90_000); // sau pull đầu
  setInterval(pinRotationTickSafe, 60 * 60_000);

  // Tự rà soát lịch PV trùng (< 30 phút cùng ngày): lịch HR đã đặt được GIỮ
  // NGUYÊN, chỉ báo HR xử lý tay (xóa tay chỉ khi HR bấm nút Xóa lịch trùng),
  // đồng thời tự loại ứng viên Kết Quả LOẠI (ẩn khỏi danh sách).
  // Chạy sau pull đầu + mỗi 5 phút (chỉ chạm lịch sắp tới, lịch đã qua không đụng).
  const interviewDedupeTickSafe = () => {
    dedupeDuplicateInterviews(adapter, services.notificationsService, { dryRun: true, actorId: 'SYSTEM' })
      .then(r => {
        if (r && r.removedCount > 0) {
          console.log(`[interview-dedupe] Phát hiện ${r.removedCount} lịch PV trùng — đã báo HR xử lý tay, giữ nguyên lịch HR đã đặt.`);
        }
        return enforceScreeningOutcomes(adapter, services.notificationsService, 'SYSTEM');
      })
      .then(r => {
        if (r && r.rejectedCount > 0) {
          console.log(`[interview-dedupe] Tự động loại ${r.rejectedCount} ứng viên LOẠI.`);
          try {
            io.emit('data:updated', { entity: 'candidates', data: { action: 'auto-rejected', rejected: r.rejectedCount }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch(err => console.warn('[interview-dedupe] tick error:', err?.message || err));
  };
  setTimeout(interviewDedupeTickSafe, 120_000);
  setInterval(interviewDedupeTickSafe, 5 * 60_000);

  // Tự kẹp lịch OFF tuần quá 2 ngày/NV/tuần về đúng 2 ngày mới nhất (giữ 2 phiếu mới
  // nhất, hủy phần thừa do lọt đếm/bấm đúp/dữ liệu cũ) — chạy sau pull đầu + mỗi 5 phút,
  // không cần HR bấm nút. Có thay đổi -> bắn realtime để các cổng tải lại ngay.
  const weeklyOffClampTickSafe = () => {
    (services.schedulesService as any).clampWeeklyOffOverLimit('SYSTEM', false)
      .then((r: any) => {
        if (r && r.cancelledCount > 0) {
          console.log(`[weekly-off-clamp] Đã kẹp ${r.cancelledCount} phiếu OFF quá 2 ngày/tuần về đúng 2 ngày mới nhất.`);
          try {
            io.emit('data:updated', { entity: 'leaves', data: { action: 'weekly-off-overlimit-clamp', cancelled: r.cancelledCount }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch((err: any) => console.warn('[weekly-off-clamp] tick error:', err?.message || err));
  };
  setTimeout(weeklyOffClampTickSafe, 150_000);
  setInterval(weeklyOffClampTickSafe, 5 * 60_000);

  // Tự đồng bộ ca trùng OFF cũ: ca làm trùng ngày OFF của cùng NV (từ hôm nay)
  // thì ngày OFF thành ca làm — chạy sau pull đầu + mỗi 60s, không cần HR bấm nút.
  // Có thay đổi -> bắn realtime để lịch 2 cổng hết cảnh báo trùng ngay.
  const shiftOffSyncTickSafe = () => {
    (services.schedulesService as any).syncShiftOffOverlaps('SYSTEM', false)
      .then((r: any) => {
        if (r && r.cancelledCount > 0) {
          console.log(`[shift-off-sync] Đã chuyển ${r.cancelledCount} ngày OFF trùng ca thành ca làm việc.`);
          try {
            io.emit('data:updated', { entity: 'leaves', data: { action: 'shift-off-overlap-sync', cancelled: r.cancelledCount }, timestamp: new Date().toISOString() });
            io.emit('data:updated', { entity: 'schedules', data: { action: 'shift-off-overlap-sync', cancelled: r.cancelledCount }, timestamp: new Date().toISOString() });
          } catch { /* non-fatal */ }
        }
      })
      .catch((err: any) => console.warn('[shift-off-sync] tick error:', err?.message || err));
  };
  setTimeout(shiftOffSyncTickSafe, 150_000);
  setInterval(shiftOffSyncTickSafe, 60_000);

  // Nhắc HR trước giờ PV 15 phút (mỗi 60s): inbox bền vững + popup realtime.
  const interviewReminderTickSafe = () => {
    interviewReminderTick(adapter, services.notificationsService, Date.now())
      .then(r => {
        if (!r || r.reminded.length === 0) return;
        for (const item of r.reminded) {
          console.log(`[interview-reminder] Sắp PV: ${item.candidateName} ${item.timeSlot} ${item.date} (còn ${item.minutesLeft}p).`);
          try {
            io.emit('system:notification', {
              id: `notif_${Date.now()}_${item.submissionId}`,
              type: 'CANDIDATE',
              title: `⏰ Sắp tới giờ PV: ${item.candidateName} (${item.timeSlot} — còn ${item.minutesLeft} phút)`,
              message: `${item.candidateName} phỏng vấn lúc ${item.timeSlot} ngày ${item.date}. HR chuẩn bị vào Meet trước 5 phút!`,
              linkTab: 'hr-interviews',
              origin: 'ADMIN',
              metadata: { submissionId: item.submissionId },
              targetRoles: ['ADMIN', 'HR'],
              timestamp: new Date().toISOString(),
            });
          } catch { /* non-fatal */ }
        }
      })
      .catch(err => console.warn('[interview-reminder] tick error:', err?.message || err));
  };
  setTimeout(interviewReminderTickSafe, 30_000);
  setInterval(interviewReminderTickSafe, 60_000);

  // Tự đánh VẮNG PV không phép (phương án A, mỗi 5 phút): INVITED quá giờ hẹn
  // 30 phút vẫn im lặng -> NO_SHOW + xóa lịch giải phóng slot + báo HR.
  const interviewNoShowTickSafe = () => {
    interviewNoShowTick(
      adapter,
      services.notificationsService,
      async (sid: string) => {
        await services.employeesService.markInterviewNoShow(sid, 'SYSTEM', 'Quá giờ hẹn 30 phút không xác nhận');
        try {
          const syncSvc = (adapter as any)?.syncService;
          syncSvc?.markInterviewScheduleCleared?.(sid);
          await (adapter as any)?.pushCandidatesNow?.();
        } catch { /* tick sau thử lại */ }
      },
      Date.now()
    )
      .then(r => {
        for (const m of r?.marked || []) {
          console.log(`[interview-noshow] Vắng PV: ${m.candidateName} (${m.submissionId}).`);
          try {
            io.emit('system:notification', {
              id: `notif_${Date.now()}_${m.submissionId}`,
              type: 'CANDIDATE',
              title: `🚫 ${m.candidateName} vắng PV không phép (quá giờ 30 phút)`,
              message: 'Lịch đã tự hủy để giải phóng slot. Muốn PV lại thì đặt lịch mới cho bạn.',
              linkTab: 'hr-interviews',
              origin: 'ADMIN',
              metadata: { submissionId: m.submissionId },
              targetRoles: ['ADMIN', 'HR'],
              timestamp: new Date().toISOString(),
            });
          } catch { /* non-fatal */ }
        }
      })
      .catch(err => console.warn('[interview-noshow] tick error:', err?.message || err));
  };
  setTimeout(interviewNoShowTickSafe, 60_000);
  setInterval(interviewNoShowTickSafe, 5 * 60_000);

  // Backup snapshot tự động mỗi 24h + tự verify; fail thì báo ADMIN/HR trong app.
  const autoBackupTick = async () => {
    try {
      const snap = await adapter.createBackupSnapshot(`Auto ${new Date().toISOString().slice(0, 10)}`);
      const check = await adapter.testRecovery(snap.snapshot_id).catch(() => null);
      if (!check?.success) throw new Error('Verify snapshot thất bại');
      console.log(`[auto-backup] Snapshot ${snap.snapshot_id} OK (${snap.size_mb}MB)`);
    } catch (err: any) {
      console.error('[auto-backup] FAILED:', err?.message || err);
      try {
        const admins = await adapter.listAdminAccounts();
        const ids = admins.filter(a => (a.role === 'ADMIN' || a.role === 'HR') && a.is_active !== false).map(a => a.admin_id);
        if (ids.length > 0) {
          await services.notificationsService.sendNotification({
            recipientIds: ids,
            type: 'BACKUP_FAILED',
            severity: 'URGENT',
            title: '🚨 Backup tự động THẤT BẠI',
            summary: `Snapshot định kỳ lỗi: ${err?.message || err}. Kiểm tra Google Drive/Sheets ngay.`,
            actorId: 'SYSTEM',
          });
        }
      } catch { /* không làm sập scheduler */ }
    }
  };
  setTimeout(autoBackupTick, 5 * 60_000);
  setInterval(autoBackupTick, 24 * 60 * 60_000);
});

// Tắt êm khi Render sleep/deploy (gửi SIGTERM): xả hàng đợi ghi Sheets nền
// trước khi thoát — nếu không, check-in vừa báo "thành công" (mới nằm trong
// bộ nhớ, append đang bay) sẽ mất vĩnh viễn, reload lại báo chưa check-in.
let shuttingDown = false;
const gracefulShutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[${signal}] Đang tắt êm: xả ghi Sheets nền...`);
  (async () => {
    try {
      await (adapter as any)?.flushSheetsWrites?.(20000);
    } catch { /* cố hết sức */ }
    try {
      await new Promise<void>(resolve => server.close(() => resolve()));
    } catch { /* bỏ qua */ }
    process.exit(0);
  })();
  // Lưới an toàn: quá 25s chưa xong thì thoát luôn (platform sẽ SIGKILL).
  setTimeout(() => process.exit(0), 25000).unref();
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { server, io };
