import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { GoogleSheetsAdapter } from '../src/repositories/google-sheets.adapter.js';

describe('ỤM BÒ MILK V5.1 - FULL UAT SPECIFICATION TESTS', () => {
  let adapter: GoogleSheetsAdapter;
  let app: any;
  let adminToken: string;
  let hrToken: string;
  let store130Token: string;
  let mktToken: string;
  let probationToken: string;
  let officialToken: string;

  beforeEach(async () => {
    adapter = new GoogleSheetsAdapter();
    adapter.getMockAdapter().seedInitialData();
    const created = createApp(adapter);
    app = created.app;

    // Login Admin
    const adminRes = await request(app).post('/auth/admin/login').send({
      username: 'admin',
      password: 'admin123',
    });
    adminToken = adminRes.body.token;

    // Login HR
    const hrRes = await request(app).post('/auth/admin/login').send({
      username: 'hr_lead',
      password: 'hr123',
    });
    hrToken = hrRes.body.token;

    // Login Store CN130
    const storeRes = await request(app).post('/auth/admin/login').send({
      username: 'store_130',
      password: 'store123',
    });
    store130Token = storeRes.body.token;

    // Login MKT
    const mktRes = await request(app).post('/auth/admin/login').send({
      username: 'mkt_lead',
      password: 'mkt123',
    });
    mktToken = mktRes.body.token;

    // Login Probation Employee (EMP_001, phone 0901111222)
    const probRes = await request(app).post('/auth/employee/phone-login').send({
      phone: '0901111222',
    });
    probationToken = probRes.body.token;

    // Login Official Employee (EMP_002, phone 0903333444)
    const offRes = await request(app).post('/auth/employee/phone-login').send({
      phone: '0903333444',
    });
    officialToken = offRes.body.token;
  });

  // --- AUTH TESTS ---
  describe('AUTH: Kiểm tra Đăng nhập & Kích hoạt Tài khoản', () => {
    it('AUTH-01: SĐT chưa tồn tại -> Từ chối, mã lỗi ACCOUNT_NOT_FOUND', async () => {
      const res = await request(app).post('/auth/employee/phone-login').send({
        phone: '0988777666',
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('ACCOUNT_NOT_FOUND');
    });

    it('AUTH-02: SĐT có hồ sơ nhưng PENDING_ACTIVATION -> Từ chối, báo chưa kích hoạt', async () => {
      const res = await request(app).post('/auth/employee/phone-login').send({
        phone: '0905555666', // EMP_003
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('PENDING_ACTIVATION');
    });

    it('AUTH-03: Admin kích hoạt nhưng API Sheets lỗi -> Không báo thành công, tài khoản không đổi trạng thái', async () => {
      // Simulate quota error in Sheets
      adapter.getMockAdapter().simulateQuotaError = true;

      const res = await request(app)
        .post('/admin/employee-accounts/ACC_003/activate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('SHEETS_UNAVAILABLE');

      // Check account still PENDING_ACTIVATION
      adapter.getMockAdapter().simulateQuotaError = false;
      const acc = await adapter.getAccountById('ACC_003');
      expect(acc?.account_status).toBe('PENDING_ACTIVATION');
    });

    it('AUTH-04: ACTIVE đúng giai đoạn; Revocation chặn truy cập', async () => {
      // 1. Check probation login stage
      const probRes = await request(app).post('/auth/employee/phone-login').send({
        phone: '0901111222',
      });
      expect(probRes.status).toBe(200);
      expect(probRes.body.stage).toBe('PROBATION');

      // 2. Admin revokes account
      const revokeRes = await request(app)
        .post('/admin/employee-accounts/ACC_001/revoke')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expectedVersion: 1, status: 'REVOKED' });
      expect(revokeRes.status).toBe(200);

      // 3. Subsequent login fails
      const subLogin = await request(app).post('/auth/employee/phone-login').send({
        phone: '0901111222',
      });
      expect(subLogin.status).toBe(400);
      expect(subLogin.body.error).toBe('REVOKED');
    });

    it('AUTH-05: Hai account cùng SĐT -> Báo lỗi DUPLICATE_PHONE_NEEDS_HR', async () => {
      const res = await request(app).post('/auth/employee/phone-login').send({
        phone: '0909999000',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('DUPLICATE_PHONE_NEEDS_HR');
    });
  });

  // --- RBAC TESTS ---
  describe('RBAC: Kiểm tra Phân quyền & BranchScope', () => {
    it('RBAC-01: Store CN130 gọi dữ liệu CN261 -> Bị chặn 403 BRANCH_SCOPE_VIOLATION', async () => {
      const res = await request(app)
        .get('/employees?branchId=CN261')
        .set('Authorization', `Bearer ${store130Token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('BRANCH_SCOPE_VIOLATION');
    });

    it('RBAC-02: Marketing gọi API bảng lương / payslips -> Bị chặn 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/payroll/runs')
        .set('Authorization', `Bearer ${mktToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });
  });

  // --- SCHEDULES & SWAP TESTS ---
  describe('SCHED: Quản lý Lịch & Đổi Ca', () => {
    it('SCHED-01: Duyệt nghỉ phép hợp lệ', async () => {
      const leaveRes = await request(app)
        .post('/leave-requests')
        .set('Authorization', `Bearer ${probationToken}`)
        .send({
          branchId: 'CN130',
          leaveType: 'DOT_XUAT',
          requestedDate: '2026-09-25',
          reason: 'Bận việc gia đình đột xuất',
        });
      expect(leaveRes.status).toBe(200);

      const reviewRes = await request(app)
        .post(`/leave-requests/${leaveRes.body.result.request_id}/review`)
        .set('Authorization', `Bearer ${store130Token}`)
        .send({ status: 'APPROVED', note: 'Đã duyệt' });

      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.result.status).toBe('APPROVED');
    });

    it('SCHED-02: Swap thất bại giữa chừng -> NEEDS_RECONCILIATION', async () => {
      // Create swap request
      const swapRes = await request(app)
        .post('/swap-requests')
        .set('Authorization', `Bearer ${probationToken}`)
        .send({
          requesterAssignmentId: 'SHIFT_001',
          targetEmployeeId: 'EMP_002',
          targetAssignmentId: 'SHIFT_002',
          reason: 'Đổi ca đi học',
        });
      const swapId = swapRes.body.result.swap_id;

      // Partner accepts
      await request(app)
        .post(`/swap-requests/${swapId}/respond`)
        .set('Authorization', `Bearer ${officialToken}`)
        .send({ accept: true });

      // Inject partial write failure
      adapter.getMockAdapter().simulatePartialWriteError = true;

      // Manager attempts approve
      const approveRes = await request(app)
        .post(`/swap-requests/${swapId}/approve`)
        .set('Authorization', `Bearer ${store130Token}`)
        .send({ accept: true });

      expect(approveRes.status).toBe(400);
      expect(approveRes.body.error).toContain('NEEDS_RECONCILIATION');
      adapter.getMockAdapter().simulatePartialWriteError = false;
    });
  });

  // --- ATTENDANCE TESTS ---
  describe('ATT: Điểm danh & Bằng chứng', () => {
    it('ATT-01: Retry check-in cùng request_id -> 1 event receipt, không tạo 2 công', async () => {
      const requestId = 'REQ_TEST_IDEMPOTENCY_001';
      const payload = {
        requestId,
        assignmentId: 'SHIFT_001',
        type: 'CHECK_IN',
        clientTime: '2026-09-23T06:55:00+07:00',
        gps: {
          latitude: 10.776889,
          longitude: 106.700806,
          accuracy: 10,
        },
      };

      const res1 = await request(app)
        .post('/attendance/events')
        .set('Authorization', `Bearer ${probationToken}`)
        .send(payload);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post('/attendance/events')
        .set('Authorization', `Bearer ${probationToken}`)
        .send(payload);
      expect(res2.status).toBe(200);

      // Verify identical event IDs
      expect(res1.body.result.event_id).toBe(res2.body.result.event_id);
    });

    it('ATT-02: GPS ngoài phạm vi chi nhánh (>300m) -> ghi nhận cờ OUT_OF_BOUNDS', async () => {
      const res = await request(app)
        .post('/attendance/events')
        .set('Authorization', `Bearer ${probationToken}`)
        .send({
          requestId: 'REQ_OUT_OF_BOUNDS_001',
          assignmentId: 'SHIFT_001',
          type: 'CHECK_IN',
          clientTime: '2026-09-23T07:00:00+07:00',
          gps: {
            latitude: 10.500000, // far away
            longitude: 106.500000,
            accuracy: 10,
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.result.gps_status).toBe('OUT_OF_BOUNDS');
    });

    it('ATT-03: Check-out sớm -> Ghi nhận is_early: true và số phút lệch', async () => {
      // Shift 1 ends at 12:00, checking out at 11:30
      const res = await request(app)
        .post('/attendance/events')
        .set('Authorization', `Bearer ${probationToken}`)
        .send({
          requestId: 'REQ_EARLY_OUT_001',
          assignmentId: 'SHIFT_001',
          type: 'CHECK_OUT',
          clientTime: '2026-09-23T11:30:00+07:00',
          gps: {
            latitude: 10.776889,
            longitude: 106.700806,
            accuracy: 10,
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.result.is_early).toBe(true);
      expect(res.body.result.minutes_deviation).toBe(30);
    });
  });

  // --- PAYROLL TESTS ---
  describe('PAY: Lập Kỳ Lương & Bảo mật Phiếu Lương', () => {
    it('PAY-01: Tính kỳ lương theo rate snapshot (Thử việc 21k, Chính thức 25.5k)', async () => {
      const period = '2026-09';
      const calcRes = await request(app)
        .post(`/payroll/${period}/calculate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ branchScope: 'CN130' });

      expect(calcRes.status).toBe(200);
      const items = calcRes.body.result.items;
      const probItem = items.find((i: any) => i.employee_id === 'EMP_001');
      const offItem = items.find((i: any) => i.employee_id === 'EMP_002');

      expect(probItem.rate_snapshot).toBe(21000);
      expect(offItem.rate_snapshot).toBe(25500);
    });

    it('PAY-02: Người tạo kỳ lương tự duyệt -> Chặn SEPARATION_OF_DUTIES_VIOLATION', async () => {
      // Finance creates run
      const finLogin = await request(app).post('/auth/admin/login').send({
        username: 'finance_lead',
        password: 'fin123',
      });
      const finToken = finLogin.body.token;

      const runRes = await request(app)
        .post('/payroll/2026-09/calculate')
        .set('Authorization', `Bearer ${finToken}`)
        .send({ branchScope: '*' });
      const runId = runRes.body.result.run.run_id;

      // Same user attempts approval
      const approveRes = await request(app)
        .post(`/payroll/${runId}/approve`)
        .set('Authorization', `Bearer ${finToken}`);

      expect(approveRes.status).toBe(400);
      expect(approveRes.body.error).toBe('SEPARATION_OF_DUTIES_VIOLATION');
    });

    it('PAY-03: Nhân viên A xem /me/payslips chỉ nhận phiếu lương của chính mình', async () => {
      // Calculate & publish run as Admin
      const calcRes = await request(app)
        .post('/payroll/2026-09/calculate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ branchScope: '*' });
      const runId = calcRes.body.result.run.run_id;

      await request(app)
        .post(`/payroll/${runId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`); // different user

      await request(app)
        .post(`/payroll/${runId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Probation employee EMP_001 checks payslips
      const slipsRes = await request(app)
        .get('/me/payslips')
        .set('Authorization', `Bearer ${probationToken}`);

      expect(slipsRes.status).toBe(200);
      expect(Array.isArray(slipsRes.body)).toBe(true);
      slipsRes.body.forEach((slip: any) => {
        expect(slip.employee_id).toBe('EMP_001');
      });
    });
  });

  // --- DATA FAILURE TESTS ---
  describe('DATA: Quota Exceeded & Fault Tolerance', () => {
    it('DATA-01: Google Sheets quota timeout -> SHEETS_UNAVAILABLE, không báo success giả', async () => {
      adapter.getMockAdapter().simulateNetworkError = true;

      const res = await request(app)
        .get('/admin/employee-accounts')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('SHEETS_UNAVAILABLE');
    });
  });
});
