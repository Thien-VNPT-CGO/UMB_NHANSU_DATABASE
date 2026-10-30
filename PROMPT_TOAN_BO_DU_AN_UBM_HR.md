# PROMPT TÁI TẠO TOÀN BỘ DỰ ÁN — HỆ THỐNG QUẢN LÝ NHÂN SỰ ỤM BÒ MILK (UmBoMilk HR) V5.1 / v1.0.0

> **Mục đích prompt:** Dùng prompt này để yêu cầu một AI lập trình (hoặc một đội dev) tái tạo lại **100% dự án** với đầy đủ từng tab, từng chức năng, từng tính năng, từng quy tắc nghiệp vụ như bản đang chạy thật. Mọi con số, khung giờ, mã lỗi, API, quy trình dưới đây đều lấy từ source code thực tế của dự án (nhánh `main`, commit `3ce7d97`) — KHÔNG phải ý tưởng bàn giao.

---

## MỤC LỤC

1. Bối cảnh doanh nghiệp & tổng quan
2. Kiến trúc kỹ thuật & công nghệ
3. Mô hình dữ liệu (Google Sheets Master + Drive)
4. Vai trò & phân quyền (RBAC)
5. Backend — API, xác thực, realtime, dịch vụ nghiệp vụ
6. WEB QUẢN TRỊ (admin-web) — toàn bộ tab & chức năng theo từng vai trò
7. WEB NHÂN VIÊN (employee-web) — toàn bộ tab & chức năng
8. Thư viện dùng chung `@ubm/shared`
9. Design System (giao diện hồng UmBoMilk)
10. Realtime — Socket.IO events
11. Quy tắc nghiệp vụ cốt lõi (bắt buộc tuân thủ)
12. Triển khai, Docker, CI/CD, biến môi trường
13. Tiêu chí nghiệm thu (UAT checklist)

---

# 1. BỐI CẢNH DOANH NGHIỆP & TỔNG QUAN

## 1.1. Doanh nghiệp

**Ụm Bò Milk** — chuỗi cửa hàng bán lẻ sữa tại TP.HCM, nhận diện thương hiệu màu **hồng (#E85D92) trên nền kem (#FFF8F4)**, mascot bò sữa. Hệ thống quản lý toàn bộ nhân sự: tuyển dụng, thử việc, chấm công bằng GPS + ảnh + kiểm tra đồng phục, xếp lịch theo ca, tính lương và phát phiếu lương ký điện tử 3 bên.

## 1.2. Địa điểm làm việc — 6 địa điểm (đúng tọa độ, bán kính chấm công)

| Mã | Tên đầy đủ | Địa chỉ | Tọa độ (lat, lng) | Bán kính GPS | Định biên |
|---|---|---|---|---|---|
| `CN130` | CN1 | 130 Vạn Kiếp, Q.Bình Thạnh | 10.797820, 106.693450 | **300m** | 2–5 NV |
| `CN261` | CN2 | 261 Tô Hiến Thành, Q.10 | 10.776650, 106.666420 | 300m | 2–5 NV |
| `CN120` | CN3 | 120 Hoàng Diệu 2, TP.Thủ Đức | 10.856950, 106.764310 | 300m | 2–5 NV |
| `CN111` | CN4 | 111 Tôn Đản, Q.4 | 10.758820, 106.705840 | 300m | 2–5 NV |
| `XUONG_SX` | Xưởng Sản Xuất Củ Chi | Củ Chi | 10.974420, 106.494900 | **500m** | 4–15 NV (Quản đốc) |
| `VAN_PHONG` | Văn Phòng Trụ Sở | 10 Đặng Thai Mai, Phú Nhuận | — | 300m | 1–20 NV |

## 1.3. Nhân sự & giai đoạn làm việc

- **Vòng đời nhân viên:** `PRE_ONBOARDING → PROBATION (thử việc) → OFFICIAL (chính thức) → TERMINATED`. Có `EmployeeStageHistory` lưu lịch sử giai đoạn + đơn giá theo kỳ.
- **Nhóm (`EmployeeGroup`):** `STORE` (cửa hàng) / `XUONG` (xưởng) / `VAN_PHONG` (văn phòng) / `SALE`.
- **Mã nhân viên:** phát hành qua writer kiểm soát, dạng `UBM_NV000001…` (UI hiển thị `UBM_NV0000` random khi tạo mới).
- **Đơn giá lương theo giờ (snapshot từng ca):** Thử việc/SV (`TV`) **21.000đ/h**; Chính thức (`CT`) **25.500đ/h**; phụ cấp **OT 30.000đ/suất** (làm ≥10h/ngày = 1 suất, ≥15h = 2 suất).
- **Phạt đi trễ theo tier:** trễ 5–29 phút = **30.000đ (FLAT_30K)**; 30–59 phút = **50% lương ca (HALF_SHIFT)**; ≥60 phút = **100% lương ca, không lương (FULL_SHIFT)**; trễ <5 phút không phạt. Ưu tiên mức phạt server ghi nhận lúc check-in (`fine_tier`/`fine_amount`).
- **Thử việc 12 ngày:** 7 ngày làm + 5 ngày OFF, kết thúc bằng buổi vấn đáp Google Meet + đề thi đầu ra.
- **Nhân viên chính thức:** bắt buộc đăng ký **2 ngày OFF/tuần** trong cổng mở **Thứ 6 09:00 → Thứ 7 09:00**; đăng ký xong mới mở khóa toàn bộ app.
- **Điều chỉnh công:** 1 phiếu/tuần; tự động từ chối sau **30 phút** HR chưa duyệt; tự xóa sau **7 ngày**; bù công cả ngày (`BU_CONG_NGAY`) tốn **5 điểm bù công** (tích 1 ca check-in+out = +2 điểm).

## 1.4. Ca làm việc chuẩn (Asia/Ho_Chi_Minh, GMT+7)

| Mã ca | Tên | Khung giờ | Số giờ |
|---|---|---|---|
| `CA_1` | Ca Sáng ☀️ | 07:00 – 12:00 | 5h |
| `CA_2` | Ca Chiều 🌤️ | 12:00 – 18:00 | 6h |
| `CA_3` | Ca Tối 🌙 | 18:00 – 23:00 | 5h |

Cửa check-in mở **trước giờ ca 30 phút**; check-out chỉ được **từ giờ tan ca trở đi**; ca **khóa** nếu quá **3 giờ** từ giờ vào mà chưa check-in (nghỉ không lương).

## 1.5. Hai web app + backend (không tạo app thứ ba)

1. **WEB QUẢN TRỊ** (`apps/admin-web`, cổng 3005 dev) — 5 vai trò nội bộ: ADMIN 16 tab / HR 16 tab / STORE 10 tab / FINANCE 12 tab / MARKETING 9 tab.
2. **WEB NHÂN VIÊN** (`apps/employee-web`, cổng 3006 dev, mobile-first 480px) — NV Thử việc 10 tab / NV Chính thức 10 tab; đăng nhập **SĐT + PIN 6 số**.
3. **BACKEND** (`apps/backend`, cổng 4005) — Node.js + Express + TypeScript + Socket.IO, dữ liệu gốc là **Google Sheets Master**, ảnh lưu **Google Drive**, ghi qua **Single-Writer Queue** chống xung đột, kèm **Zalo Personal Bot** tự sinh link Google Meet + gửi thư mời phỏng vấn từ Zalo cá nhân của HR.

---

# 2. KIẾN TRÚC KỸ THUẬT & CÔNG NGHỆ

## 2.1. Monorepo npm workspaces

```
umbo-milk-hr-system v1.0.0 (private, node >=20)
├── packages/shared/      @ubm/shared — types TS + constants + attendance-grid (build CJS dist/ + ESM dist-esm/)
├── apps/backend/         @ubm/backend — Express + TS + Socket.IO (tsconfig module nodenext)
├── apps/admin-web/       @ubm/admin-web — Vite + React 18 + TS (cổng 3005, proxy /api → 4005)
└── apps/employee-web/    @ubm/employee-web — Vite + React 18 + TS (cổng 3006, base './')
```

Scripts root: `build:shared | build:backend | build:admin | build:employee` (qua `--workspace=@ubm/...`); `build` chạy tuần tự shared → backend → admin → employee; `start`: `node apps/backend/dist/server.js`; `dev:backend | dev:admin | dev:employee`. Prebuild của 2 web app tự sinh `src/app-version.ts` (`APP_COMMIT = "<git commit>"` qua `scripts/gen-version.cjs`) để đối chiếu bản app vs bản API.

**Thư viện chính:** React 18, socket.io-client 4.8.1, lucide-react, jsqr (quét QR ngân hàng), tesseract.js (OCR fallback), @ubm/shared (file: link). **Không dùng Tailwind/shadcn ở bản thật** — CSS thuần design system hồng trong `index.css`.

## 2.2. Backend

- Express + TypeScript, ESM (`.js` import suffix), schema validation bằng **Zod** (`apps/backend/src/validators/*`) qua middleware `validate`.
- **Google Sheets là database chính** (repository pattern: `sheets.interface.ts` → `google-sheets.adapter.ts` (live) / `mock-sheets.adapter.ts` (dev/CI seed dữ liệu mẫu)).
- **Single-Writer Queue** (`repositories/single-writer-queue.ts`): mọi ghi tuần tự, mỗi thao tác có `operation_id` + `idempotency_key` + `expected_version` (optimistic concurrency `version`); ghi một phần → `NEEDS_RECONCILIATION`, không công bố dữ liệu mới, không tự rollback bằng cách xóa hàng.
- **Google Sheets Sync Service** (chu kỳ `SHEETS_SYNC_INTERVAL_MS` mặc định 5s + webhook onEdit): pull/push dữ liệu Sheets ↔ bộ nhớ; phát hiện thay đổi bằng hash nội dung (không phải số dòng) để bắn realtime ngay cả khi sửa 1 ô.
- **Socket.IO** realtime: chỉ phát event **sau khi Sheets xác nhận ghi**; room theo role/branch do **server** xây từ phiên, không tin client khai.
- Ảnh chấm công/bằng chứng lưu **Google Drive** (service account), fallback đĩa local `apps/backend/data/` (`photo-disk.store.ts`), path bất biến `attendance/YYYY/MM/DD/{branch}/{employee}/{shift}/{event}_IN|OUT.jpg`.
- **Rate limit** riêng auth (`AUTH_RATE_LIMIT_MAX`) và chung (`GENERAL_RATE_LIMIT_MAX`); JWT secret ≥16 ký tự, production thiếu `JWT_SECRET` → sinh secret ngẫu nhiên tạm thời + cảnh báo nguy hiểm (mọi phiên hết hạn khi restart).
- **Zalo Bot** (`zalo.service.ts`): gửi tin mời phỏng vấn từ Zalo cá nhân của HR (session `.zalo-session.json` — KHÔNG BAO GIỜ commit), sinh link Google Meet cho buổi vấn đáp đầu ra.

## 2.3. Base URL & runtime

- Production VPS: `https://umbomilk-nhansu-diemdanh.duckdns.org/api` (Docker + Nginx + SSL; image all-in-one — backend serve luôn dist của cả 2 web app). Backend mặc định trỏ domain VPS, **đã loại bỏ Render (PaaS)**.
- Employee-web hỗ trợ `VITE_API_URL`, URL tùy chỉnh `localStorage('ubm_custom_api_url')` (tự dọn URL legacy `.onrender.com`), **nút "Wake Backend"** ping `GET /ping` tối đa 3 lần (2s/5s/10s) khi lỗi mạng, timeout mỗi request 25s (`AbortController`).

---

# 3. MÔ HÌNH DỮ LIỆU

## 3.1. Google Sheets Master — 13 tab server tự tạo lần đầu

`NHAN_VIEN_MASTER` · `TAI_KHOAN_NHAN_VIEN` · `ADMIN_ACCOUNTS` · `PHAN_CONG_CA` · `SU_KIEN_DIEM_DANH` · `DON_NGHI_PHEP` · `DON_DOI_CA` · `DIEU_CHINH_CONG` · `KY_LUONG` · `AUDIT_LOG` · `DANH_SACH_CHI_NHANH` · `FROM_NHAN_VIEN` · `THONGBAO_NV` (tự tạo, không tự xóa tab cũ — tab lỗi phải xóa tay).

> Lưu ý: đây là 13 tab bootstrap tối thiểu; engine sync khai báo **21 tab đầy đủ** trong `SHEETS_DEFINITIONS` (thêm `LUUTRU_CHAMCONG_TUAN, CAU_HINH_HE_THONG, BAI_THI, BAI_LAM, PHIEU_LUONG, CONG_THUC_LUONG, DULIEU_LUONG_KY, LICH_SU_GIAI_DOAN` — xem chi tiết mục 5.5).

Nguồn đối chiếu ban đầu: Sheets `UMB_NHANSU_SYNC` (ID `17iXM0zc1m17aX9AZrFMjOkPRMy2_CwWfjTRZSUPQF2w`, 23 tab kế thừa) + Google Form ứng viên (tab `FROM_NHAN_VIEN`, form ID `1rcqEKraSRhr-Tn9qwlhADlkQUei8j65bXeHF_Tmkd38`).

Chuẩn thực thể: `id` bất biến, `version` tăng (optimistic lock), `created_at/updated_at` ISO 8601 UTC, phân tách nhiệm vụ lương (người duyệt ≠ người tính).

## 3.2. Entity chính (packages/shared/src/types)

- **AdminAccount:** `admin_id, username, password_hash (bcrypt), full_name, role, branch_scope, is_active, version, created_at, updated_at`.
- **EmployeeAccount:** `account_id, employee_id, phone_normalized, account_status (ACTIVE|LOCKED), role, branch_scope, pin_hash (bcrypt), pin_must_change (PIN HR cấp → bắt đổi lần đầu), pin_changed_at, pin_rotation_cycle (kỳ YYYY-MM đã đổi — chu kỳ đổi PIN 1–5 hàng tháng), version, …`
- **EmployeeMaster:** `employee_id, employee_code, full_name, phone_normalized, id_card_number?, email?, gender (NAM|NU|KHAC), birth_date?, employment_status, group, default_branch_id, default_shift_code?, current_rate_per_hour, start_date, official_date?, bank_name/account/holder?, bank_qr_img? (dataURL ≤45KB NV tự tải), avatar_base64?, contract_docs? ({probation?, official?} — metadata file HĐLĐ, xem 6.3.17), version, …`
- **ShiftAssignment:** `assignment_id, employee_id, branch_id, shift_code, date, start_at/end_at, status (DRAFT|PUBLISHED|CANCELLED), schedule_version, …` — **chỉ ca PUBLISHED là lịch chính thức / được điểm danh / được đổi**.
- **AttendanceEvent:** `event_id, request_id (idempotency), assignment_id, employee_id, branch_id, type (CHECK_IN|CHECK_OUT|ABSENT), client_time, server_received_at, gps_latitude/longitude/accuracy?, distance_meters?, gps_status (VALID|OUT_OF_BOUNDS|LOW_ACCURACY|MOCK_DETECTED|UNAVAILABLE), drive_object_id?, drive_path, uniform_pink_ratio? (% hồng — chặn <10%), is_early/is_late?, minutes_deviation?, fine_tier (NONE|FLAT_30K|HALF_SHIFT|FULL_SHIFT), fine_amount?, compensated_by/at/reason?, created_at`. **Event gốc bất biến — sai công chỉ sửa qua DIEU_CHINH_CONG.**
- **AttendanceAdjustment:** `adjustment_id, assignment_id, employee_id, branch_id, reason, minutes_requested, minutes_approved?, approver_id?, status (PENDING|APPROVED|REJECTED), review_note?, evidence_drive_id?, version, …`
- **LeaveRequest:** `request_id, employee_id, branch_id, leave_type (DOT_XUAT|HANG_TUAN|THU_VIEC), requested_date, shift_code?, reason, status (PENDING|APPROVED|REJECTED|CANCELLED), reviewed_by/at/note?, version, …`
- **SwapRequest:** `swap_id, swap_kind (EMPLOYEE_SWAP | HR_DISPATCH (+30.000đ phụ cấp) | HR_SUPPORT), requester_id, requester_assignment_id, target_employee_id, target_assignment_id, reason, status (PENDING_PARTNER|PARTNER_ACCEPTED|APPROVED|REJECTED|CANCELLED), bonus_amount?, support_branch_id/date/shift_code?, version, …`
- **PayrollRun:** `run_id, period (YYYY-MM), branch_scope, status (DRAFT|RECONCILED|APPROVED|PUBLISHED|PAID), total_employees/hours/amount, created_by, reconciled_by/at?, approved_by/at? (≠ người lập), published_by/at?, paid_by/at?, version`.
- **PayslipItem:** `item_id, run_id, employee_id, employee_code, full_name, period, total_shifts, absent_shifts?, standard_hours, rate_snapshot, standard_pay, tv_hours/tv_pay?, ct_hours/ct_pay?, allowance, bonus, deduction, net_pay` + mở rộng Excel: `ot_slots, phu_cap_ot, luong_cb, ot_extra, bonus_extra, ung_luong, tru_kpi, dong_phuc, tong_cong, tong_luong, thuc_lanh` + `sign_lap/sign_quanly/sign_nhanvien (PayslipSignature: name, at, img PNG dataURL), slip_published_at/confirmed_at/paid_at/by, bank_name/account/holder, status`.
- **CandidateApplication** (ứng viên từ Google Form): `submission_id, full_name, phone_normalized, birth_year, apply_position, preferred_branch_id, status (NEW→NEED_INFO→INVITED_INTERVIEW→CONFIRMED→RESCHEDULE_REQUESTED→INTERVIEWED→ACCEPTED/REJECTED/NO_SHOW), interview_date, interview_time_slot, interviewer_id, interview_score, interview_rubric (store 9 câu | office 7 câu), interview_score_detail, zalo_invite_status (SENT|NOT_FRIEND|FAILED), zalo_uid, …` + 17 cột biểu mẫu: gender, education_level, hometown, registered_shift, branch_name, experience, emergency_handling, facebook_url, referral_source, ai_score, screening_result, source_code, **vip / vip_at / vip_by, vip_rank** (1 = ưu tiên nhất, độc lập theo chi nhánh).
- **TestPaper / TestSubmission:** đề gồm `questions[] (options ≥2, correct_index, points)`, `pass_score` (thang 10, mặc định **8**), `time_limit_seconds` (mặc định **480**), status DRAFT|ASSIGNED|CLOSED; submission `answers[], score?, passed?`.
- **NotificationOutboxItem / NotificationInboxItem:** outbox phát đi (dedupe_key, severity SUCCESS|ACTION_REQUIRED|URGENT|SYSTEM, target_path, delivery_status QUEUED|SENT|FAILED, attempts); inbox từng người (type `emp.checkin/emp.checkout/emp.leave/emp.swap/emp.test/emp.pin/system…`, read_at, acknowledged_at, dismissed_at).
- **OperationRecord:** `operation_id, idempotency_key, entity_type, entity_id, expected_version, operation_state (PENDING|IN_PROGRESS|COMPLETED|NEEDS_RECONCILIATION|FAILED), actor_id, outcome?, error?`.
- **AuditLogEntry:** `log_id, timestamp, actor_id, actor_role, action, target_entity, target_id, details, ip_address?`.
- **BankQrConfig + PayrollFormula + PayrollPeriodInput:** cấu hình QR VietQR; công thức lương `{rateTV, rateCT, otPerSlot, otThreshold1, otThreshold2}`; 6 cột Kế toán nhập tay `{luong_cb, ot_extra, bonus_extra, ung_luong, tru_kpi, dong_phuc, note}`.

## 3.3. Mã lỗi chuẩn (ERROR_CODES — trả đúng mã cho client xử lý)

`ACCOUNT_NOT_FOUND, DUPLICATE_PHONE_NEEDS_HR, EMPLOYMENT_NOT_ELIGIBLE, UNAUTHORIZED, FORBIDDEN, BRANCH_SCOPE_VIOLATION, VERSION_CONFLICT, NEEDS_RECONCILIATION, SHEETS_UNAVAILABLE, GPS_OUT_OF_BOUNDS, GPS_ACCURACY_LOW, CAMERA_REQUIRED, SHIFT_NOT_FOUND, ATTENDANCE_ALREADY_RECORDED, SEPARATION_OF_DUTIES_VIOLATION, WEEKLY_OFF_REGISTRATION_REQUIRED, WEEKLY_OFF_WINDOW_CLOSED` + các mã runtime: `ACCOUNT_LOCKED, PIN_NOT_SET, PIN_RESET_REQUIRED, INVALID_PIN, PIN_CHANGE_REQUIRED, SHEETS_LOADING, EMERGENCY_LEAVE_NOT_GRANTED, MAX_2_SHIFTS_PER_DAY, WEAK_PASSWORD, INVALID_CREDENTIALS, ADMIN_NOT_FOUND, INVALID_REFRESH_TOKEN, WEEKLY_OFF_MUST_REGISTER_2_DAYS`.

---

# 4. VAI TRÒ & PHÂN QUYỀN (RBAC)

## 4.1. SystemRole

`ADMIN | HR | STORE | FINANCE | MARKETING | EMPLOYEE`

## 4.2. UserPermission (11 quyền)

1. `ACCOUNTS_MANAGE` — kích hoạt/khóa tài khoản, cấp vai trò
2. `EMPLOYEES_MANAGE` — tiếp nhận nhân viên, chuyển chính thức
3. `SCHEDULE_MANAGE` — lập/duyệt/phát lịch
4. `LEAVE_APPROVE` — duyệt nghỉ phép, đổi ca
5. `ATTENDANCE_VIEW` — xem chấm công
6. `ATTENDANCE_VERIFY` — xác nhận công, duyệt điều chỉnh công
7. `PAYROLL_CREATE` — lập bảng lương DRAFT
8. `PAYROLL_APPROVER` — duyệt bảng lương (tách biệt nhiệm vụ)
9. `ANNOUNCEMENTS_MANAGE` — phát thông báo nội bộ
10. `AUDIT_VIEW` — xem audit log & sức khỏe hệ thống
11. `READ_ONLY` — chỉ xem

## 4.3. Nguyên tắc

- `AuthUser { id, employeeId?, role, branchScope ('CN130'|…|'*'), phone, fullName, permissions[], mustChangePin? }` — `mustChangePin` chặn mọi API ngoài allowlist đến khi đổi PIN xong.
- **Backend luôn kiểm role + permission + branchScope** (không chỉ ẩn nút frontend); NV chỉ xem dữ liệu của chính mình; room socket do server xây từ phiên.
- Admin quan sát toàn hệ thống nhưng **không mặc định thay HR/Finance duyệt nghiệp vụ chuyên môn**. Store không xem chi nhánh khác / lương toàn công ty. MKT không xem lương, GPS, ảnh điểm danh, hồ sơ HR nhạy cảm.

---

# 5. BACKEND — API, XÁC THỰC, REALTIME, DỊCH VỤ NGHIỆP VỤ

## 5.1. Cấu trúc backend (`apps/backend/src`)

| Thành phần | File | Vai trò |
|---|---|---|
| HTTP server + mọi route | `app.ts` (~4.900 dòng) | Middleware, ~150 endpoint, broadcast realtime, serve SPA static, error handler |
| Runtime | `server.ts` | Socket.IO (rooms + auth), ~15 scheduler nền, graceful shutdown xả queue ghi Sheets |
| Adapter DB live | `repositories/google-sheets.adapter.ts` | `ISheetsRepository` trả dữ liệu từ RAM ngay lập tức, pull/push Sheets nền |
| Kho RAM | `repositories/mock-sheets.adapter.ts` | In-memory engine — là "kho chính" của adapter live; cũng dùng cho dev/CI (seed demo) |
| Sync engine | `services/google-sheets-sync.service.ts` | Pull/push từng tab, upload Drive, ZIP tuần, lưu trữ `LUUTRU_CHAMCONG_TUAN` |
| Hàng đợi ghi | `repositories/single-writer-queue.ts` | Mọi ghi nghiệp vụ qua 1 hàng đợi per-entity + khóa lạc quan (`expectedVersion`) |
| Photo store | `services/photo-disk.store.ts` | Lưu ảnh chấm công/bằng chứng ra đĩa (`ATTENDANCE_PHOTO_DIR`) sống sót khi Drive lỗi |
| Services | auth, password, pin-rotation, accounts, employees, schedules, auto-schedule, attendance, payroll, notifications, zalo, tests, weekly-off, auto-reminders, interview-slots/rubric/reminders/dedupe, ai-scorer | Nghiệp vụ chi tiết (mục 5.6) |
| Validators (Zod) | `validators/{common,auth,hr,admin}.validator.ts` | `phoneLoginBody, adminLoginBody, checkinBody, payrollCalculateBody, employeeChangePinBody…` |

**Mô hình vận hành:** Sheets là nguồn bền vững; RAM là cache tương tác; mọi ghi → RAM tức thì + socket realtime, ghi Sheets đồng bộ (điểm danh/phiếu đổi ca — timeout 12s) hoặc nền (append/full-sync dồn 1 lần/10s). Pull Sheets mỗi 10s hoặc ngay khi webhook onEdit.

## 5.2. Xác thực & JWT

- **NV:** `POST /auth/employee/phone-login` — SĐT + PIN (legacy 4–8 chỉ dùng cho lần đổi cuối; PIN mới bắt buộc **đúng 6 số** từ 10/2026). Trả access (8h) + refresh (7d) + `mustChangePin`.
- **Admin:** `POST /auth/admin/login` (username + password).
- Claims: `sub (account_id), employeeId, role, branchScope, tv` — `tv` = token version khớp `account.version` (lock/đổi PIN → revoke toàn bộ).
- Seed: `ADMIN_SEED_PASSWORD / HR_SEED_PASSWORD / FINANCE_SEED_PASSWORD` (chỉ lần đầu, đổi ngay sau login).
- **Xoay PIN định kỳ** (`pin-rotation.service.ts`): tick mỗi 1h, ngày **1–5 hàng tháng** tự nhắc/đánh dấu tới kỳ, cập nhật `Kỳ PIN` trên `TAI_KHOAN_NHAN_VIEN`, thông báo NV + HR; không dùng được PIN cũ 4–8 số làm PIN mới.
- **Rate limit:** auth `120 req/15 phút` trên IP+account (chỉ đếm FAIL, config `AUTH_RATE_LIMIT_MAX`); general `30000 req/5 phút` (miễn Bearer, config `GENERAL_RATE_LIMIT_MAX`).
- **Weekly-off gate (`checkWeeklyOffGate`):** role EMPLOYEE + OFFICIAL + cổng đang OPEN + đường API KHÔNG nằm allowlist (`/me`, `/leave-requests`, `/leaves`, `/auth/`) + chưa đủ 2 ngày OFF tuần → chặn toàn bộ API khác bằng `WEEKLY_OFF_REGISTRATION_REQUIRED`.

## 5.3. Bảng endpoint đầy đủ (~150 endpoint)

### Hạ tầng / Public / Webhook
| Endpoint | Quyền | Mô tả |
|---|---|---|
| `GET /` | public | Thông tin hệ thống (tên, version, mode Sheets) |
| `GET /ping` | public | Heartbeat đánh thức backend |
| `GET /version` | public | Version backend (`GIT_COMMIT`) |
| `GET /health` | public | Adapter mode, Sheets configured, pending writes, DB counts |
| `GET /api/sheets/status` | public | Trạng thái sync (spreadsheetId/Url, candidate, drive, authError, 21 tab) |
| `GET /api/weekly-off-window` | public | Cửa sổ 2 OFF/tuần đang hiệu lực (phase OPEN/REMINDER/CLOSED, mở bù VIP) |
| `GET /public/portal-maintenance` | public | Trạng thái bảo trì cổng (`CAU_HINH_HE_THONG`) |
| `GET/POST /public/interview/rsvp` | public (token JWT `typ=interview-rsvp`, HẾT HẠN 7 ngày) | Trang RSVP ứng viên: Xác nhận / Xin dời lịch (`RESCHEDULE_REQUESTED` + xóa slot) |
| `POST /hooks/sheets-edit` | webhook | Sửa Sheet trên web → onEdit → trigger pull (chống dồn 3s); header `x-webhook-secret` = `SHEETS_WEBHOOK_SECRET` |

### Auth / `/me` (nhân viên)
| Endpoint | Mô tả |
|---|---|
| `POST /auth/employee/check-phone` | Bước 1: SĐT có tồn tại |
| `POST /auth/employee/phone-login` | Bước 2: login SĐT + PIN |
| `POST /auth/employee/change-pin` | Đổi PIN đúng 6 số |
| `POST /auth/admin/login`, `POST /auth/refresh`, `POST /auth/admin/change-password` | Admin + refresh + đổi mật khẩu |
| `GET /me`, `PUT /me/profile` | Hồ sơ tôi / NV tự sửa (avatar, email, ngày sinh, CCCD, ngân hàng + ảnh QR) |
| `GET /me/colleagues`, `GET /me/colleague-shifts` | Đồng nghiệp cùng chi nhánh / ca thật của B (đổi ca) |
| `GET /me/weekly-off-status`, `GET /me/emergency-leave-status` | Trạng thái đăng ký OFF / lượt nghỉ đột xuất còn lại |
| `GET /me/schedule`, `GET /me/attendance`, `GET /me/monthly-timesheet` | Lịch / sự kiện chấm công / bảng công tháng của tôi |
| `GET /me/tests`, `POST /me/tests/:id/submit` | Bài thi của tôi / nộp bài (chấm tự động thang 10, 1 lần nộp) |
| `GET /me/payslips`, `POST /me/payslips/:id/confirm` | Phiếu lương của tôi / ký nhận (tên + ảnh chữ ký) |
| `POST /me/probation-extra-shift` | Thử việc tự thêm ca (max 2 ca/ngày, không đụng lịch PUBLISHED, không vượt 12 ngày) |
| `POST /me/probation-self-swap` | Thử việc tự đổi ca (cùng ngày/cùng chi nhánh, ca còn trống) |
| `POST /leaves/probation-off` | Thử việc đăng ký 5 ngày OFF → server tự xếp 7 ca |
| `GET /me/probation-assessment` | Lịch kiểm tra đầu ra của tôi |
| `GET /me/attendance/photo/:eventId`, `GET /me/attendance/adjustments/:id/photo` | Xem ảnh điểm danh / ảnh phiếu bổ sung công của chính mình |
| `GET /me/notifications`, `POST /me/notifications/:id/read`, `POST /me/notifications/:id/acknowledge` | Hộp thư / đã đọc / đã xác nhận |

### Quản lý tài khoản & NV (HR/ADMIN)
| Endpoint | Mô tả |
|---|---|
| `GET /admin/employee-accounts` (+`/duplicates`) | Danh sách TK NV + SĐT trùng |
| `GET /admin/employee-shifts/:employeeId` | Lịch 1 NV theo tuần |
| `POST /admin/employee-accounts/send-pin-zalo` | Gửi PIN khởi tạo qua Zalo cá nhân HR |
| `POST /admin/employee-accounts/:id/reset-pin` | **Đã gỡ (HTTP 410)** theo chuẩn 2026-10 |
| `POST /admin/emergency-leave/grant`, `GET /admin/emergency-leave/grants` | Kích hoạt nghỉ đột xuất 1 lần cho NV thử việc |
| `GET /admin/system-meet-url` | Link Meet hệ thống (`SYSTEM_MEET_URL`) |
| `POST /admin/probation-assessment/schedule`, `/meet-done`, `GET /list` | Lập lịch vấn đáp đầu ra + ghi kết quả PASS/FAIL |
| `GET /admin/sync-status` | Trạng thái sync đầy đủ |
| `GET/POST/PUT/DELETE /employees…` | CRUD NV: tự sinh `UBM_NV######`, tự tạo account ACTIVE + PIN hash, bulk-import, version locking, avatar Drive |
| `POST /employees/:id/lock` / `/unlock` | Khóa (LOCKED + xóa PIN + hủy phiên + xóa ca từ hôm nay) / Mở khóa (cấp PIN 6 số mới bắt đổi) |
| `POST /employees/:id/transition-official` | Chuyển chính thức: gỡ ca thử việc từ hôm nay, set `official_date` |
| `POST /admin/employees/cleanup-probation-shifts` | Dọn ca thử việc sót (preview/dryRun trước) |
| `PUT /employees/:id/default-shift` | Gán ca cố định (BOT xếp theo) |
| `GET /employees/:id/avatar`, `DELETE /employees/:id`, `DELETE /employee-accounts/:id` | Avatar Drive / xóa (tombstone chống hồi sinh) |
| `POST /employees/:id/contract`, `GET /employees/:id/contract/:kind`, `DELETE /employees/:id/contract/:kind` | Hợp đồng lao động Thử việc/Chính thức: upload (PDF/ảnh/DOC/DOCX ≤6MB → Drive + đĩa VPS), xem/tải, gỡ |

### Tuyển dụng / Ứng viên / Phỏng vấn (HR/ADMIN)
| Endpoint | Mô tả |
|---|---|
| `GET /applications`, `POST /applications/import` | Danh sách ứng viên (lọc status, VIP) + import từ Forms/Sheets |
| `POST /interviews` | Đặt lịch PV: khung cố định **30 phút**, 08:00–17:00 (giờ :00/:30, muộn nhất 16:30), không trùng <30 phút |
| `PUT/DELETE /applications/:id` | Sửa whitelist (registered_shift, branch, VIP + ranking theo chi nhánh, khôi phục REJECTED→NEW) / xóa |
| `POST /applications/:id/score` | Chấm rubric (`store` 9 câu / `office` 7 câu, max 13, PASS ≥12, dính LOẠI tự REJECTED), xóa lịch PV khỏi danh sách |
| `POST /applications/:id/approve` | **Duyệt thử việc:** chặn nếu <12 điểm → tạo NV + account + PIN + lịch 12 ngày |
| `POST /applications/:id/reject` | Loại: xóa lịch + xóa thư mời Zalo |
| `POST /interviews/:id/cancel` / `/confirm` / `/no-show` | Hủy (về NEW, giữ điểm) / HR xác nhận UV tham gia / vắng mặt (xóa slot) |
| `GET /admin/interviews/duplicates`, `POST /admin/interviews/dedupe` | Phát hiện + xử lý lịch trùng (về NEW, giữ giờ sớm nhất) |
| `GET/PUT /interviews/invite-draft` | Bản nháp Thư Mời PV (riêng từng user, `ubm_invite_draft_v1`) |
| `POST /interviews/:id/send-zalo-invite` | Gửi thư mời qua Zalo cá nhân HR (kết bạn → tin nhắn + link RSVP + link Meet) |

### Zalo cá nhân (zca-js unofficial)
| Endpoint | Mô tả |
|---|---|
| `POST /admin/zalo/qr/start`, `GET /admin/zalo/qr/image/:loginId`, `POST /admin/zalo/qr/cancel/:loginId` | Đăng nhập QR Zalo (session `.zalo-session.json`) |
| `GET /admin/zalo/status`, `POST /admin/zalo/disconnect` | Trạng thái / đăng xuất xóa session |
| `POST /admin/zalo/find-user`, `POST /admin/zalo/send-friend-request` | Tra SĐT → uid / kết bạn trước khi nhắn tin |

### Lịch làm việc / BOT xếp ca
| Endpoint | Mô tả |
|---|---|
| `GET /schedules` | Lịch theo tuần/chi nhánh (branch scope) |
| `POST/PUT/DELETE /schedules/shifts…` | Tạo/sửa/hủy ca: chặn trùng NV+ngày+ca, NV thử việc không chiếm ca chính thức |
| `POST /schedules/:week/publish` | **PUBLISH TUẦN = BOT tự xếp trước** (`autoScheduleService.execute()` tạo ca trống rồi duyệt toàn bộ) → realtime `schedule.published` + `markAbsentees` |
| `POST /schedules/auto-plan` | Chạy BOT chỉ xem trước, không ghi |
| `GET/POST /schedules/backfill-new-official` | Bù ca thiếu cho NV vừa chính thức (tối đa 4 tuần, giá TV) |
| `GET /admin/shifts/non-live`, `POST /admin/shifts/purge-non-live`, `GET /admin/shifts/duplicates`, `POST /admin/shifts/dedupe-duplicates` | Dọn ca DRAFT/CANCELLED + ca trùng |

### Điểm danh / GPS / Điều chỉnh công
| Endpoint | Mô tả |
|---|---|
| `POST /attendance/checkin` | Check-IN: GPS Haversine ≤ bán kính chi nhánh (accuracy ≤150m), ảnh Drive, ghi `SU_KIEN_DIEM_DANH` ngay + phạt trễ theo tier |
| `POST /attendance/checkout` | Check-OUT: phải có IN trước (rematch `request_id`, nhiều ca độc lập) |
| `POST /attendance/events`, `GET /attendance/events`, `GET /attendance/events/archive` | Sự kiện / lọc theo NV-ngày / archive tuần cũ |
| `GET /attendance/photo/:eventId`, `GET /attendance/adjustments/:id/photo` | Xem ảnh (Drive → đĩa → inline RAM) |
| `DELETE /attendance/events/:id` | Xóa sự kiện (GPS vượt; tombstone 120s) |
| `POST /attendance/adjustments`, `GET`, `DELETE :id`, `POST :id/approve`, `POST :id/repair` | Phiếu bổ sung công (TTL 30 phút duyệt, 23:00–08:00 cấm tạo, BU_CONG_NGAY trừ 5 điểm) / duyệt / sửa phiếu lỗi |
| `POST /attendance/complete-shift` | (ADMIN) Buộc ca COMPLETED khi NV quên checkout (+2 điểm bù công) |
| `GET /admin/attendance/photo-stats`, `POST /admin/attendance/reverify-gps` | Thống kê ảnh / rà GPS lại tất cả sự kiện + xóa vượt bán kính |
| `GET /admin/attendance/export-day|export-week|export-day|export-work-week` | Export Excel công ngày/tuần/tuần toàn chi nhánh (ZIP) |
| `GET /admin/attendance/reconcile` | Đối soát: sự kiện không khớp ca, thiếu IN/OUT, mồ côi, vắng oan |

### Nghỉ phép / Đổi ca / OFF tuần
| Endpoint | Mô tả |
|---|---|
| `POST/GET /leave-requests` (+ alias `/leaves`) | Tạo/xem đơn: `HANG_TUAN` (tự ghi nhận) / `DOT_XUAT` (duyệt) |
| `POST /leave-requests/:id/review` | Duyệt/từ chối (HR/STORE) |
| `PUT /leaves/weekly-off` (alias `/leave-requests/weekly-off`) | **THAY THẾ NGUYÊN TỬ** 2 OFF: xóa ngày cũ + tạo mới, kiểm xung đột |
| `POST /admin/weekly-off/resolve-overlaps`, `/reset-all` | Gỡ OFF trùng (người sau về NEW) / Reset ALL (mật khẩu `WEEKLY_OFF_RESET_PASS` = `Umbomilk@999`) |
| `POST /admin/weekly-off/open` / `/close`, `GET /manual-status` | **MỞ BÙ VIP** cổng ngoài khung (30–120 phút) |
| `POST /admin/shift-off-overlaps/sync` | Ca trùng ngày OFF → chuyển thành ca làm việc |
| `POST /swap-requests` | NV gửi tráo ca (`EMPLOYEE_SWAP`): B đồng ý là đổi ngay, không phụ cấp |
| `POST /swap-requests/dispatch` | HR điều phối (`HR_DISPATCH`, +30.000đ) |
| `POST /swap-requests/support` | HR chuyển NV hỗ trợ CN khác (`HR_SUPPORT`) |
| `POST /swap-requests/:id/respond` / `/approve` | B xác nhận (đổi ngay) / HR duyệt |
| `POST /admin/swaps/audit-out-of-week` | Hủy phiếu đổi ca ngoài tuần gửi + hoàn lịch về chủ cũ |

### Bài thi
| Endpoint | Mô tả |
|---|---|
| `POST /tests` | HR tạo đề + giao ≤200 NV (socket `test.assigned`) |
| `GET /tests` | Danh sách bài + submissions (HR/STORE) |
| `GET /me/tests`, `POST /me/tests/:id/submit` | Bài của NV / nộp (thang 10, pass 8) — `BAI_LAM`, realtime `test.graded` |
| `GET /admin/test-bank/preview`, `POST /admin/tests/from-bank` | Ngân hàng câu hỏi từ Spreadsheet ngoài (`TEST_BANK_SPREADSHEET_ID`) |

### Payroll
| Endpoint | Mô tả |
|---|---|
| `POST /payroll/:period/calculate` | Tính kỳ lương chuẩn |
| `POST /payroll/:period/calculate-formula` | Tính **công thức Excel** (1 ca = 0.5 công; LCB/OT/Bonus/KPI tay từ `DULIEU_LUONG_KY`) |
| `POST /payroll/:period/backfill` | Tính lại kỳ cũ |
| `GET/PUT /payroll/formula/:period` | Tham số: đơn giá TV/CT, tiền 1 suất OT, ngưỡng OT 10h/15h |
| `GET/PUT /payroll/inputs/:period` | 6 cột nhập tay: LCB, OT thêm, Bonus, Ứng, Trừ KPI, Đồng phục |
| `GET /payroll/runs` (+`:id`) | Kỳ lương theo trạng thái |
| `POST /payroll/:run/reconcile` / `/approve` / `/publish` / `/mark-paid` | Đối soát → duyệt (chặn `SEPARATION_OF_DUTIES` nếu duyệt == tạo) → phát hành (`payroll.published`) → chốt trả |
| `GET /payroll/period-slips/:period`, `POST …/ensure` | Phiếu từng NV / bảo đảm đủ hàng NV |
| `POST /payroll/slips/:id/sign`, `/fast-sign`, `/publish`, `/return`, `/mark-paid` | Ký 3 bên (`lap`/`quanly`/`nhanvien`) / ký nhanh / phát phiếu / trả về DRAFT / ghi đã chuyển |
| `POST /payroll/:run/publish-all-slips` | Phát hành toàn bộ phiếu kỳ |
| `GET/PUT /payroll/signature-templates` | Mẫu chữ ký mặc định |
| `GET/PUT /payroll/bank-config`, `PUT /payroll/slips/:id/bank` | TK công ty + thông tin ngân hàng trên phiếu (VietQR) |
| `GET /payroll/profile-income/:employeeId` | Thu nhập lịch sử 1 NV |
| `GET /admin/reports/official-monthly`, `GET /admin/reports/finance-timesheet` | Báo cáo tháng / bảng công tài chính B4 |

### Thông báo / Dashboard / Reminders
| Endpoint | Mô tả |
|---|---|
| `POST /announcements` | Gửi thông báo toàn hệ thống (ADMIN/MARKETING) |
| `GET /admin/notifications`, `POST /admin/notifications/backfill` | Outbox / backfill inbox bị mất |
| `GET /admin/dashboard/stats` | Stats tổng quan mọi vai trò |
| `POST /admin/reminders/trigger-checkin` | Ép chạy nhắc check-in qua Zalo |

### Cấu hình / Backup / Audit
| Endpoint | Mô tả |
|---|---|
| `GET/POST/PUT/DELETE /admin/internal-accounts…` | Tài khoản nội bộ (mật khẩu ≥6 ký tự; khóa → `admin:forceLogout`) |
| `GET /admin/branches`, `PUT /admin/branches/:id` | Chi nhánh (GPS, bán kính) |
| `GET/PUT /admin/shift-templates` | Đổi giờ từng ca |
| `GET/PUT /admin/policies`, `GET/POST /admin/maintenance`, `GET/PUT /admin/system-settings` | Chính sách / bảo trì (toàn hệ thống hoặc từng cổng) / cấu hình hệ thống (`CAU_HINH_HE_THONG`, MERGE) |
| `GET /admin/audit` | Nhật ký hệ thống |
| `GET/POST /admin/backup/snapshots`, `POST /admin/backup/test-recovery` | Backup snapshot + verify recovery |
| `GET /admin/integrations/status`, `POST /admin/integrations/sync-now`, `POST /admin/integrations/pull-now` | Tình trạng tích hợp (Sheets, Drive, Zalo, socket, webhook, 21 tab) + đồng bộ ngay |

## 5.4. 15 Scheduler nền (server.ts, giờ VN UTC+7)

| Tick | Chu kỳ | Việc |
|---|---|---|
| `autoPullSheetsTick` | 10s | Pull toàn bộ Sheets; counts đổi → `data:updated entity:all` |
| `adjustmentExpiryTickSafe` | 60s | Phiếu bổ sung công >30 phút chưa duyệt → tự REJECT + inbox NV; REJECT >7 ngày → tự DELETE |
| `absenteeTickSafe` | 15 phút | Ca PUBLISHED quá giờ kết thúc 30p không check-in → ghi ABSENT |
| `attendanceWeekTick` | 60s | CN 20:00 nhắc HR tải ZIP; CN 23:30 lưu trữ tuần (ZIP Drive + chuyển `LUUTRU_CHAMCONG_TUAN`) + reset phiếu đổi ca; T2 00:05 chạy bù |
| `payrollAutoTick` | 5 phút | Ngày 1 lúc 00:10–00:30 tự tính nháp lương kỳ trước (nếu chưa có) + thông báo ADMIN/FINANCE (`PAYROLL_AUTO_DRAFT`) |
| `notifResetTick` | 5 phút | 23:00 hằng ngày reset trạng thái đã đọc tin trong RAM (Sheets giữ nguyên) |
| `pinRotationTickSafe` | 60 phút | Xoay PIN chu kỳ 1–5 hàng tháng |
| `interviewDedupeTickSafe` | 5 phút | Cảnh báo lịch PV trùng (HOLD, HR xử tay) + tự loại UV kết quả LOẠI |
| `weeklyOffClampTickSafe` | 5 phút | Kẹp OFF quá 2 ngày/tuần về 2 ngày gần nhất |
| `weeklyOffOverlapTickSafe` | 5 phút | Gỡ OFF trùng cùng ca/cùng chi nhánh về NEW |
| `shiftOffSyncTickSafe` | 60s | Ca trùng ngày OFF → chuyển thành ca làm việc |
| `interviewReminderTickSafe` | 60s | Nhắc HR trước giờ PV 15 phút |
| `interviewNoShowTickSafe` | 5 phút | Vắng PV quá 30p → NO_SHOW + xóa slot |
| `photoRetryTickSafe` | 5 phút | Upload lại ảnh chấm công thất bại (giữ inline `DRV_LOCAL_...`) |
| `weeklyOffTick` + `autoRemindersTickSafe` | 60s / 5 phút | Nhắc trước 5 phút khi mở cổng OFF; nhắc check-in qua Zalo trước ca 15–20 phút; nhắc duyệt quá 24h; thử việc gần kết thúc; `autoBackupTick` 24h backup tự động + verify |

Tắt êm (SIGTERM/SIGINT): `gracefulShutdown` — `flushSheetsWrites(20s)`, `server.close`, deadline 25s để không thủng ca vừa check-in.

## 5.5. Lưu trữ Google Sheets — 21 tab (SHEETS_DEFINITIONS)

| # | Tab | Cột chính |
|---|---|---|
| 1 | `NHAN_VIEN_MASTER` | ID/Mã/Họ Tên/SĐT/Trạng Thái/Nhóm/CN/Lương Giờ/Ngày Bắt Đầu/Phiên Bản/Ca Cố Định/Ngày Chính Thức/Email/Giới Tính/Ngày Sinh/CCCD/Avatar Drive/Ngân Hàng/STK/Chủ TK/QR Base64/**Điểm Tích Lũy/Điểm Đã Dùng** |
| 2 | `TAI_KHOAN_NHAN_VIEN` | ID TK/ID NV/SĐT/Vai Trò/Trạng Thái/Phiên Bản/**PIN hash/Bắt Buộc Đổi/Đổi PIN Cuối/Kỳ PIN** |
| 3 | `ADMIN_ACCOUNTS` | ID/Tên Đăng Nhập/Mật Khẩu (hash)/Họ Tên/Vai Trò/Phạm Vi CN/Trạng Thái/Ngày Tạo |
| 4 | `PHAN_CONG_CA` | ID Ca/ID NV/Mã CN/Mã Ca/Ngày/Bắt Đầu/Kết Thúc/Trạng Thái/Phiên Bản |
| 5 | `SU_KIEN_DIEM_DANH` | ID SK/ID Ca/ID NV/Loại IN-OUT/Thời Gian/GPS lat-lng/Khoảng cách/Trạng Thái GPS/Ảnh Drive/ID Request/**% Hồng Đồng Phục**/Trễ/Sớm/Lệch/Phạt nấc/Phạt tiền |
| 6 | `LUUTRU_CHAMCONG_TUAN` | Cùng cấu trúc + "Tuần Lưu Trữ" (hồ sơ tuần cũ) |
| 7 | `DON_NGHI_PHEP` | ID/ID NV/CN/Loại/Ngày/Ca/Lý Do/Trạng Thái/Người Duyệt/Ghi Chú/Ngày Tạo |
| 8 | `DON_DOI_CA` | ID/Người YC/Ca YC/Người Nhận/Ca Đổi/Lý Do/Trạng Thái/Người Duyệt/**LOẠI PHIẾU/Phụ Cấp/CN Hỗ Trợ/Ngày Hỗ Trợ/Ca Hỗ Trợ** |
| 9 | `DIEU_CHINH_CONG` | ID/ID Ca/ID NV/Lý Do/Phút Được Duyệt/Người Duyệt/Trạng Thái/Ghi Chú/Ảnh Drive |
| 10 | `KY_LUONG` | Mã Kỳ/Tháng Năm/Trạng Thái/Tổng Tiền/Ngày Tạo/Ngày Chốt/Ngày Chi Trả |
| 11 | `AUDIT_LOG` | Mã Log/Thời Gian/Người/Vai Trò/Hành Động/Đối Tượng/ID/Chi Tiết |
| 12 | `DANH_SACH_CHI_NHANH` | Mã CN/Tên CN/Địa Chỉ/GPS lat-lng/Bán Kính (m)/Trạng Thái |
| 13 | `CAU_HINH_HE_THONG` | Tham Số/Giá Trị/Mô Tả/Cập Nhật Lần Cuối (kèm latch scheduler: remindedCheckin, payrollAutoDone, attendanceArchive…) |
| 14 | `THONGBAO_NV` | ID Inbox/ID TB/Người Nhận/Loại/Tiêu Đề/Nội Dung/Mức Độ/Tab Liên Quan/Thời Gian/Đã Đọc |
| 15 | `FROM_NHAN_VIEN` (sheet riêng `CANDIDATE_SPREADSHEET_ID`) | 26 cột: Ngày ĐK → … → Điểm AI (thang 14)/Kết Quả/Trạng Thái/Mã Nguồn/Ngày PV/Khung Giờ PV/Người PV/Zalo Thư Mời/Điểm PV/Chi Tiết Chấm/**VIP/Hạng VIP** |
| 16 | `BAI_THI` | ID/Tiêu Đề/Mô Tả/Câu Hỏi (JSON)/Điểm Đạt/Giới Hạn Giây/Trạng Thái/Người Tạo/Phiên Bản |
| 17 | `BAI_LAM` | ID/ID Bài/ID NV/Trạng Thái/Đáp Án (JSON)/Điểm/Đạt/Ngày Nộp/Phiên Bản |
| 18 | `PHIEU_LUONG` | 39 cột: ID Phiếu → LCB/Thưởng/Khấu Trừ/Thực Nhận/Suất OT/OT Thêm/6 cột tay/Tổng/**Ký Lập/Ql/NV (tên + thời gian + ảnh chữ ký)**/Phát Hành/Xác Nhận/Chi Trả Lúc |
| 19 | `CONG_THUC_LUONG` | Kỳ/Đơn Giá TV/CT/Tiền 1 Suất OT/Ngưỡng OT 1-2 (h)/Người CN/CN Lúc |
| 20 | `DULIEU_LUONG_KY` | Kỳ/ID NV/LCB (tay)/OT Thêm/Bonus Thêm/Ứng Lương/Trừ KPI/Trừ Đồng Phục/Ghi Chú |
| 21 | `LICH_SU_GIAI_DOAN` | ID/ID NV/Giai Đoạn/Hiệu Lực Từ/Lương Giờ/Người Duyệt/Ghi Chú/Phiên Bản |

**Cơ chế sync:** Service Account (scopes spreadsheets + drive); pull batch + merge theo `version` (bản version cao thắng); **tombstone** chống hồi sinh dòng đã xóa trong ~120s; rate-limit ghi Sheets 1100ms/lần (`WRITE_RATE_LIMIT_MS`); mọi ô ngày/giờ ép TEXT (`'2026-10-14T06:29:31+07:00`) tránh Sheets tự đổi kiểu; startup ping + pull 8×8s đến khi có nhân sự (không có → NV login nhận `SHEETS_LOADING/SHEETS_UNAVAILABLE`); webhook Apps Script onEdit (`sheets-webhook.gs`) POST `/hooks/sheets-edit` với `x-webhook-secret`.

**Ảnh + ZIP:** ảnh base64 → lưu đĩa ngay → upload Drive (`GOOGLE_DRIVE_FOLDER_ID`); upload fail giữ inline + tick 5 phút retry; ZIP tuần upload Drive; avatar Drive ID; chữ ký phiếu lương base64 trong `PHIEU_LUONG`.

## 5.6. Nghiệp vụ chi tiết quan trọng

- **BOT xếp lịch (4 quy tắc):** (1) ưu tiên ca cố định của NV; (2) trừ 2 OFF đã đăng ký + `DOT_XUAT` APPROVED; (3) 2 NV cùng chi nhánh cùng ca không trực cùng ngày; (4) người ít ngày công tháng được ưu tiên — mục tiêu `MIN_MONTHLY_DAYS=10`, `TARGET_MONTHLY_DAYS=12`. NV thử việc có lịch độc lập, không chiếm slot NV chính thức.
- **Tính lương:** mỗi ca PUBLISHED/COMPLETED tính theo giai đoạn ngày đó (`rateOnDate` — trước `official_date` giá TV); phạt trễ trừ vào; công thức Excel từ `CONG_THUC_LUONG` + `DULIEU_LUONG_KY`; tổng hợp **Tổng Lương / Tổng / Thực Lãnh**; auto-draft mùng 1 hàng tháng.
- **Điểm tích lũy:** hoàn thành ca +2 điểm; `BU_CONG_NGAY` tiêu 5 điểm; lưu cột `Điểm Tích Lũy/Điểm Đã Dùng` trên `NHAN_VIEN_MASTER`.
- **VietQR/QR ngân hàng:** decode QR VietQR (EMVCo TLV) phía server hỗ trợ xác thực (`parseVietQRPartial`), tick 1h dọn QR hỏng/label sai.
- **Audit log:** mọi thao tác ghi (`recordAuditLog` — `EMPLOYEE_LOCKED/UNLOCKED, CANDIDATE_SCORED, ZALO_QR_CONNECTED, WEEKLY_OFF_*, BACKFILL_*…`).

## 5.7. Biến môi trường đầy đủ (`apps/backend/.env.example`)

| Nhóm | Biến | Ghi chú |
|---|---|---|
| Server | `PORT=4005`, `NODE_ENV` | |
| JWT | `JWT_SECRET`, `JWT_ACCESS_TTL=8h`, `JWT_REFRESH_TTL=7d` | BẮT BUỘC prod ≥16 ký tự |
| Seed | `ADMIN_SEED_PASSWORD`, `HR_SEED_PASSWORD`, `FINANCE_SEED_PASSWORD` | Chỉ dùng lần đầu |
| CORS | `CORS_ORIGINS` | Hỗ trợ wildcard `*.vercel.app` |
| Rate limit | `AUTH_RATE_LIMIT_MAX=60`, `GENERAL_RATE_LIMIT_MAX=1000` | |
| Weekly-off | `WEEKLY_OFF_TZ_OFFSET_HOURS=7`, `WEEKLY_OFF_REMINDER_MINUTES=5`, `WEEKLY_OFF_RESET_PASS` | |
| Sheets | `GOOGLE_SERVICE_ACCOUNT_JSON` (hoặc EMAIL + PRIVATE_KEY), `SPREADSHEET_ID`, `CANDIDATE_SPREADSHEET_ID`, `SHEETS_SYNC_INTERVAL_MS=5000`, `SHEETS_WEBHOOK_SECRET` | Thiếu webhook secret ⇒ webhook luôn 403 |
| Drive | `GOOGLE_DRIVE_FOLDER_ID` | Trống = không upload Drive |
| Photo | `ATTENDANCE_PHOTO_DIR` | Đĩa ảnh tạm |
| Zalo | `ZALO_SESSION_PATH` (`.zalo-session.json`) | KHÔNG commit, tự khôi phục sau restart |
| Meet/URL | `SYSTEM_MEET_URL`, `ZALO_DEFAULT_MEET_URL`, `PUBLIC_BASE_URL` | Link Meet PV + base URL tạo link RSVP |
| Test bank | `TEST_BANK_SPREADSHEET_ID`, `TEST_BANK_SHEET_NAME` | |
| Version | `GIT_COMMIT` | Hiển thị ở `/version` |

---

# 6. WEB QUẢN TRỊ (apps/admin-web) — TOÀN BỘ TAB & CHỨC NĂNG

## 6.1. Đăng nhập & phiên làm việc

- Card đăng nhập trung tâm: **username + password** (truy vấn `ADMIN_ACCOUNTS` trên Sheets). Brand hồng UmBoMilk, hiệu ứng entrance, hiển thị `APP_COMMIT` ở chân màn.
- Token lưu localStorage: `ubm_admin_token` (access 8h) + `ubm_admin_admin_refresh` alias `ubm_admin_refresh` (refresh 7d) + `ubm_admin_user` (role/branch).
- **Tự refresh token khi gặp 401; retry khi 429 (tối đa 4 lần, tôn trọng Retry-After); timeout 25s.** Nút **Wake Backend** đánh thức backend VPS ngủ. Hỗ trợ **Custom API URL** (`ubm_custom_api_url`).
- Đổi mật khẩu admin: `POST /auth/admin/change-password` (yêu cầu mật khẩu cũ, ghi audit `ADMIN_PASSWORD_CHANGED`).
- Force logout từ xa qua socket `admin:forceLogout` — xóa token + văng về màn login.

## 6.2. Cấu trúc sidebar theo vai trò (ROLE_TABS — badge số riêng từng tab)

| Vai trò | Số tab | Danh sách (key — tên hiển thị) |
|---|---|---|
| **ADMIN** | 16 | `admin` Dashboard · `operations` Điểm Danh · `staff` Nhân Viên · `schedule` Lịch Làm · `off` Xin OFF · `swap` Đổi/Nhường Ca · `adjustments` Điều Chỉnh Công · `tests` Đề Thi Định Kỳ · `candidates` Ứng Viên · `probation` Thử Việc · `reports` Báo Cáo · `payroll` Bảng Lương · `bank-qr` QR Ngân Hàng · `notifications` Thông Báo · `hr-profile` Hồ Sơ NV · `settings` Cài Đặt |
| **HR** | 16 | `dashboard` Dashboard · `probation` Thử Việc · `staff` Nhân Viên Chính Thức · `operations` Lịch & Điểm Danh · `off` Xin OFF Hàng Tuần · `support` Hỗ Trợ Trực Ca · `swap` Đổi/Nhường Ca · `attendance` Điểm Danh & Sửa Công · `adjustments` Điều Chỉnh Công · `tests` Đề Thi Định Kỳ · `reports` Báo Cáo · `fin-timesheet` Chấm Công Lương · `payroll` Bảng Lương · `hr-profile` Hồ Sơ NV · `notifications` Thông Báo · `settings` Cài Đặt |
| **STORE** | 10 | `dashboard` Tổng Quan · `employees` Nhân Viên · `schedule` Lịch Làm Việc · `off` Xin OFF · `swap` Đổi Ca · `emergency` Gấp · `realtime-att` Điểm Danh RT · `confirm-att` Xác Nhận Công · `reports` Báo Cáo · `notifications` Thông Báo |
| **FINANCE** | 12 | `dashboard` Dashboard Tài Chính · `fin-timesheet` Chấm Công Lương · `fin-payroll-periods` Kỳ Lương · `fin-calculate` Tính Lương · `fin-details` Chi Tiết Lương · `fin-payslips` Phiếu Lương · `fin-bcc` Bảng Chấm Công · `fin-payroll-sheet` Bảng Thanh Toán · `fin-deductions` Trừ Giữ/KPI/Đồng phục · `fin-payment` Trả Lương · `fin-signatures` Chữ Ký Mặc Định · `fin-bank-qr` QR Ngân Hàng |
| **MARKETING** | 9 | `dashboard` Tổng Quan · `create-broadcast` Soạn Bản Tin · `audiences` Đối Tượng · `schedule` Lên Lịch · `campaigns` Chiến Dịch · `media` Media · `tracking` Tracking · `sent-list` Lịch Sử Gửi · `mkt-notifications` Thông Báo |

Tab active lưu `localStorage["ubm_active_tab"]`. Lưu ý: tab `attendance` (Điểm Danh & Sửa Công) **chỉ dành HR** — ADMIN vào trả `null`.

## 6.3. Chi tiết từng nhóm tab

### 6.3.1. Dashboard (mọi vai trò, nội dung khác nhau)
- **ADMIN:** tổng quan toàn hệ thống — số NV, chấm công hôm nay, đơn pending, trạng thái tích hợp.
- **HR:** stats nhân sự + các khối đang xử lý.
- **STORE:** 4 thẻ stats theo chi nhánh.
- **FINANCE:** Quỹ lương · Giờ công · Số phiếu phát · Trạng thái kỳ lương.
- **MARKETING:** 3 stats + nút **Soạn Bản Tin** (mở `openBroadcastModal`).

### 6.3.2. Thử Việc (`probation` — HR/ADMIN)
- **Quy tắc hiển thị:** thử việc 12 ngày (start_date → +11), mật độ 2 ca/ngày có badge ⚡, hiển thị điểm TEST tốt nhất.
- **Lên lịch đầu ra:** `GET /admin/system-meet-url` → `POST /admin/probation-assessment/schedule` `{employeeId, meetDate, meetTime, meetUrl, quizTestId}`.
- **Meet Đạt / Chưa đạt:** `POST /admin/probation-assessment/meet-done` `{employeeId, passed}`.
- **Đề Xuất Chính Thức:** `POST /employees/{id}/transition-official` `{expectedVersion, officialDate}` (optimistic lock).
- **Sửa:** `PUT /employees/{id}` (+ push Sheets ngay); **Xóa:** `DELETE /employees/{id}`.

### 6.3.3. Nhân Viên Chính Thức (`staff` — HR/ADMIN)
- Bảng **9 cột**; import hàng loạt 2 kiểu: **Tải File Mẫu CSV** (BOM UTF-8) + **Import** modal (tải file / dán dữ liệu — FILE/PASTE), preview tách **hợp lệ / không hợp lệ** → `handleExecuteOfficialImport`.
- **Khóa tài khoản:** `POST /employees/{id}/lock` — văng phiên NV + xóa PIN + xóa ca từ hôm nay, event nội bộ `ubm:employee-locked`.
- **Mở khóa:** `POST /employees/{id}/unlock` → modal đặt **PIN 6 số mới**, event `ubm:employee-unlocked`.
- Sửa / Xóa như trên.

### 6.3.4. Lịch & Điểm Danh (`operations` — HR/ADMIN)
- **Lưới tuần T2→CN**, sort CN1→CN4 theo ca cố định trong hồ sơ; chip trạng thái: `COMPLETED`, `CHECKED_IN` (nhấp nháy `fx-blink`), `MISSING_OUT`, `LOCKED`, `PENDING`, `OFF`, `PENDING_LEAVE`, `BONUS_SWAP` (+30k), `ABSENT`, `MULTI`, `NO_SHIFT`.
- **Nút:** Tải Lại Realtime (`GET /attendance/events`) · **Publish** (PublishScheduleModal — chỉ ca DRAFT mới publish) · **Bổ Sung Lịch NV** (`POST /schedules/shifts`) · **Bù ca tuần trước** (`GET`+`POST /schedules/backfill-new-official?publish=true` — chỉ ngày ≤ hôm qua và < official_date) · **Dọn Ca Không Live** (preview + xóa) · **Gỡ OFF trùng** (`POST /admin/weekly-off/resolve-overlaps`) · **Dọn Ca Trùng** (`/admin/shifts/dedupe-duplicates`).
- **Export ZIP:** `GET /admin/attendance/export-day?date=` / `GET /admin/attendance/export-work-week?weekMon=`.
- **Modal Sửa ca:** khóa ngày khi đã điểm danh. **Modal Bằng chứng:** GPS (bán kính 300m), tỷ lệ đồng phục hồng `uniform_pink_ratio` %, ảnh check-in/out (AttPhoto) + zoom.

### 6.3.5. Xin OFF Hàng Tuần (`off` — HR/ADMIN)
- `HANG_TUAN` **tự ghi nhận, không cần duyệt**; nhóm theo NV + tuần; chu kỳ reset **T6 09:00** (`currentOffCycle`).
- Nút: **Reset lịch OFF trùng ca** · **Đồng bộ ca trùng OFF** (`POST /admin/shift-off-overlaps/sync`) · **Reset ALL** (modal xác nhận nhập pass — hủy toàn bộ phiếu từ hôm nay).

### 6.3.6. Hỗ Trợ Trực Ca (`support` — HR)
- Loại `HR_SUPPORT`: `POST /swap-requests/support` `{requesterAssignmentId, targetEmployeeId, reason}` — NV B xác nhận trên cổng nhân viên là ca tạo ngay ở chi nhánh hỗ trợ.

### 6.3.7. Đổi/Nhường Ca (`swap` — HR/ADMIN)
- 2 loại: `EMPLOYEE_SWAP` (NV tự tráo) / `HR_DISPATCH` (HR điều phối, **+30.000đ thưởng**); nhóm theo tuần.
- Duyệt: `POST /swap-requests/{id}/approve` `{accept: true|false, reason}`.
- **Audit:** `POST /admin/swaps/audit-out-of-week` — tự hủy phiếu đổi ca sai tuần.

### 6.3.8. Điểm Danh & Sửa Công (`attendance` — chỉ HR)
- Dùng chung khung tuần với tab Lịch. **Nút:** **Rà soát GPS >300m** (`POST /admin/attendance/reverify-gps {date}` — xóa bản ghi vượt bán kính + yêu cầu NV điểm danh lại) · **Đối Soát Check-in/out** (`POST reconcile` — phân loại đủ/thiếu/nháp 0 công/mồ côi/vắng oan + tự phục hồi) · **Làm Mới Realtime**.
- Box ADMIN: **hoàn thành ca** (ngày + NV + ca + lý do → tự điền đủ CHECK_IN/OUT + đồng bộ lương) và **Xóa ca** (`DELETE /schedules/{assignmentId}`).
- Hover popup **lương tạm tính** (`shiftPayInfo`: đơn giá, giờ, phạt, net), thumbnail ảnh, tra phiếu đổi/nhường ca liên quan (`pickSwapOf`).

### 6.3.9. Điều Chỉnh Công (`adjustments` — HR/ADMIN)
- **Quy tắc:** 1 phiếu/tuần; tự từ chối sau 30 phút; tự xóa sau 7 ngày.
- **Duyệt/Từ chối:** `POST /attendance/adjustments/{id}/approve` `{status, minutesApproved}` — backfill công + xóa vi phạm trễ.
- **Xóa cứng:** `DELETE /attendance/adjustments/{id}` · 🔧 **Chuyển đúng ngày** (`POST .../repair`) · 🔒 **Khóa phiếu đã duyệt**.
- Gom phiếu theo folder tuần; modal chi tiết + ảnh bằng chứng `AdjPhoto`.

### 6.3.10. Đề Thi Định Kỳ (`tests` — HR/ADMIN)
- Stats: ngân hàng 120 câu · đề 25 câu / 480 giây · đạt ≥8/10 · tỷ lệ đạt 95.8%.
- **Đề Random từ Sheet:** `GET` info ngân hàng + `POST /admin/tests/from-bank` `{title, employeeIds, count}`; chọn NV gán đề (EmployeeTickPicker).
- Bảng kết quả `testSubs` (điểm / Đạt / Chờ làm); modal chi tiết đúng/sai từng câu.

### 6.3.11. Ứng Viên (`candidates` — ADMIN; HR ở RoleViews)
- Nạp từ Google Form (`FROM_NHAN_VIEN`); AI chấm điểm 9 tiêu chí thang 14 (đạt ≥8, có tiêu chí LOẠI trực tiếp); rubric phỏng vấn STORE/OFFICE (PASS ≥12/13, nhóm tiêu chí khóa `lockGroup`); mời phỏng vấn qua **Zalo Bot cá nhân HR** + Google Meet; trạng thái vòng: NEW → INVITED → CONFIRMED → INTERVIEWED → ACCEPTED/REJECTED/NO_SHOW; **VIP ranking** theo chi nhánh; bản nháp phỏng vấn lưu `ubm_invite_draft_v1`.

### 6.3.12. Báo Cáo (`reports` — HR/ADMIN/STORE)
- Chọn kỳ `YYYY-MM` → `loadMonthlyReport`; stats tổng giờ / top / bottom / tổng lương; bảng từng NV (số ca, giờ, đơn giá, lương, badge **Thực tế / Tạm tính**).

### 6.3.13. Thông Báo (`notifications` — HR/ADMIN/STORE)
- Lọc loại: `emp.checkin / checkout / leave / swap / test / pin / system`; badge URGENT/SUCCESS; đếm chưa đọc.
- **Cổng reset:** bản cũ tự reset trạng thái đã đọc lúc **6h00/ngày** (Sheets giữ nguyên).

### 6.3.14. Nhóm tab STORE (10 tab)
- `dashboard` 4 stats chi nhánh; `employees` bảng NV chi nhánh; `schedule` lưới lịch + PublishScheduleModal + điều hướng tuần; `off` duyệt `DOT_XUAT` (`POST /leave-requests/{id}/review`), `HANG_TUAN` tự ghi nhận; `swap` / `emergency` / `realtime-att` — chờ realtime; `confirm-att` — đối soát hôm nay qua `GET /attendance/events`; `reports` + `notifications`.
- **Mọi tab STORE chỉ thao tác trong `branchScope`.**

### 6.3.15. Nhóm tab FINANCE (12 tab)
- **`fin-timesheet` Chấm Công Lương:** chọn `finMonth`, expand từng ca (ngày, ca, giờ, trạng thái, check-in, trễ, lương ca, phạt); **Backfill:** `POST /payroll/{period}/backfill`; **Xuất CSV UTF-8 BOM**.
- **`fin-payroll-periods` Kỳ Lương:** stage machine `DRAFT → RECONCILED → APPROVED → PUBLISHED → PAID`, action `reconcile/approve/publish/mark-paid`; nguyên tắc **người duyệt ≠ người tính** (`SEPARATION_OF_DUTIES_VIOLATION`).
- **`fin-calculate` Tính Lương (4 bước):** B1 `POST /payroll/{period}/calculate`; B2 công thức kiểu Excel `PUT /payroll/formula/{period}` `{rateTV, rateCT, otPerSlot, otThreshold1, otThreshold2}` + `POST /payroll/{period}/calculate-formula`; B3 nhập tay 6 cột `PUT /payroll/inputs/{period}` `{luong_cb, ot_extra, bonus_extra, ung_luong, tru_kpi, dong_phuc, note}` + **Lưu tất cả**; B4 `calcLivePayslip` xem trước từng bước B1–B5.
- **`fin-details`:** bảng breakdown 12 cột.
- **`fin-payslips` Phiếu Lương:** **Ký nhanh tất cả**, **Gửi tất cả** phiếu PUBLISHED; từng phiếu: modal xem với **3 ô chữ ký** (Người Lập Phiếu `lap` / Quản Lý `quanly` / Người Nhận Tiền `nhanvien`); ảnh **VietQR** `https://img.vietqr.io/image/{bank}-{STK}-compact2.png?amount=&addInfo=LUONG {period} {code}`; nút ✍️ Chữ ký / 📢 Gửi NV / ↩️ Hoàn / 🏦 VietQR / ✅ mark-paid.
- **`fin-bcc`:** mirror sheet BCC (cột AN–AX, từng ngày 01→cuối tháng).
- **`fin-payroll-sheet`:** mirror sheet Payment (cột A–R, cột M/Q/R dạng formula).
- **`fin-deductions`:** cột N=KPI, O=Ứng, P=Đồng phục — sửa inline + Lưu.
- **`fin-payment` Trả Lương:** phiếu CONFIRMED đủ 3 chữ ký → VietQR + copy STK/tiền/nội dung + **Hoàn thành**; bulk **PAID cả kỳ**.
- **`fin-signatures` Chữ Ký Mặc Định:** chữ ký `lap` / `quanly` — họ tên + SignaturePad (canvas 440×180, nén JPEG 360px/q0.72, Vẽ lại / Lưu), nút **LƯU CẤU HÌNH** (`ubm_default_signatures`), xem trước chân phiếu.
- **`fin-bank-qr` QR Ngân Hàng:** bảng QR từng NV — NV cập nhật QR ở Hồ sơ (cổng NV) → realtime về đây cho kế toán quét chuyển khoản. Filter: ô tìm (tên/mã NV/SĐT/STK), chi nhánh, trạng thái **Có QR/Chưa có QR**; cột "Mã QR NV gửi" (thumbnail 64×64 + zoom modal + ⬇️ Tải QR) + cột "VietQR đối chiếu" (`img.vietqr.io` tab mới theo `{bank code}-{STK}-compact2.png?accountName=`); badge đếm "✅ Có QR: n/N".

### 6.3.16. Nhóm tab MARKETING (9 tab)
- `dashboard` (3 stats + Soạn Bản Tin), `create-broadcast` (soạn văn bản + đối tượng — dùng broadcast modal), `audiences` / `schedule` / `campaigns` / `media` / `tracking` — bảng tĩnh, `sent-list` — lịch sử `systemNotifications`, `mkt-notifications` — màn trạng thái hạ tầng (Socket.IO + Sheets hoạt động bình thường).

### 6.3.17. Hồ Sơ Nhân Viên (`hr-profile` — HR/ADMIN)
- **5 sub-tab:** Tổng quan / Nhân thân & Pháp lý / Hiệu suất chấm công / Lương & Thu nhập / Hợp đồng lao động.
- **Tìm kiếm không dấu** (`stripAccentsVI`), nhóm SALE ưu tiên lên đầu.
- **In hồ sơ** (`window.print` HTML riêng) · **Xuất JSON/CSV**.
- **✏️ Cập nhật hồ sơ:** modal đủ trường (Họ tên, SĐT — đổi số vẫn login được, Giới tính NAM/NU/KHAC, Ngày sinh, CCCD, Email, Ngân hàng + STK + Chủ TK); cảnh báo trường còn thiếu (Ngày sinh/CCCD/Email/Giới tính/Ca cố định/Ngày chính thức); **avatar:** chọn ảnh → nén `compressAvatarImage`, preview 64×64, **Gỡ avatar** (gửi `avatar_base64: ''`) / Hoàn tác; `PUT /employees/{id}` kèm `expectedVersion` → **push Sheets NGAY** (không pull vì pull sẽ đọc sheet cũ do push nền ~10s).
- **Thu nhập realtime:** `GET /me/profile-income` (`profIncome` + `profIncomeEmpRef`).
- **Hợp đồng lao động (upload file):** 2 khối **Thử việc** + **Chính thức** — mỗi khối hiện trạng thái (`Đã upload`/`Chưa upload`), tên file, dung lượng, thời điểm upload, nguồn lưu (`Google Drive` / `Đĩa VPS (chờ Drive)`), nút **Upload / Thay file / Xem / Gỡ**.
  - Nhận **PDF, JPG, PNG, WEBP, DOC, DOCX** — tối đa **6MB/file**; upload file mới cùng loại **thay** bản cũ (xóa file Drive cũ best-effort).
  - File lưu **Google Drive** (chính) + **đĩa VPS** (dự phòng `data/contracts`); metadata (Drive ID, tên file, MIME, size, thời điểm, người upload) lưu **1 ô JSON** `contract_docs` trên `NHAN_VIEN_MASTER` — **không** nhét base64 vào Sheet.
  - API: `POST /employees/{id}/contract` `{kind: PROBATION|OFFICIAL, fileName, mimeType, base64}` · `GET /employees/{id}/contract/{kind}` (stream, rớt xuống bản đĩa) · `DELETE /employees/{id}/contract/{kind}`; kiểm tra chữ ký file (`%PDF`, JPEG/PNG/WEBP, ZIP/OLE của DOC/DOCX) chặn file đổi đuôi. Sau khi lưu → refresh + **push Sheets NGAY**.
- **Số liệu hiệu suất realtime:** 4 thẻ + bảng "Hiệu suất chấm công" tính từ **lượt điểm danh thật** (`/attendance/events` + `/attendance/events/archive`, gộp 62 ngày gần nhất) và **lịch đã tải** (`schedAllShifts`); chỉ đếm ca có `date ≤ hôm nay`, tự tải lại khi mở tab và khi socket báo check-in/out. Dòng ghi chú hiển thị **số lượt điểm danh + số ca** và khoảng ngày thực tế đang tính.

## 6.4. Header / Topbar & tiện ích chung

- **Chuông thông báo** + badge chưa đọc; sự kiện mới → chuông **rung lắc** (`bellShake`) + âm thanh; popover danh sách tin gần nhất (loại, badge URGENT/SUCCESS, thời gian) + đánh dấu đã đọc.
- **Chỉ báo realtime online** (chấm xanh `pulse-badge` khi Socket.IO connected).
- **User menu:** tên + vai trò + chi nhánh; Đăng xuất.
- **Toast nổi** góc trên (`toast-slide-in` + thanh đếm ngược tự đóng); **Wake Backend**; cài đặt âm thanh (`ubm_sound_enabled`, ringtone `ubm_custom_ringtone`, style `ubm_notification_sound_style`).
- **Sound effects** (`sound-effects.ts`): âm click/thông báo/điểm danh — bật/tắt được.
- **PerfectScoreCelebration:** pháo hoa canvas 2D khi NV đạt điểm tuyệt đối "{total}/13 TUYỆT ĐỐI", tự đóng 15s.

---

# 7. WEB NHÂN VIÊN (apps/employee-web) — TOÀN BỘ TÍNH NĂNG

## 7.1. Màn đăng nhập 3 bước (PremiumLogin)

1. **Bước 1 — SĐT:** ô nhập `+84`; **tự kiểm tra SĐT tồn tại** (debounce 700ms khi đủ 9–12 số) → `POST /auth/employee/check-phone` `{phone} → {exists}`; số không tồn tại báo "liên hệ HR nộp hồ sơ"; nút "Đổi số khác".
2. **Bước 2 — PIN 6 ô:** 6 ô password 1 số/ô (auto-focus, backspace lùi, paste 6 số, phím mũi tên); đủ 6 ô **tự xác thực sau 180ms** → `POST /auth/employee/phone-login` `{phone, pin}`. Sai → ô rung + đỏ + xóa; xử lý đúng mã: `ACCOUNT_LOCKED, ACCOUNT_NOT_FOUND, PIN_NOT_SET, PIN_RESET_REQUIRED, INVALID_PIN, DUPLICATE_PHONE_NEEDS_HR, SHEETS_LOADING (server mới boot ~30s), SHEETS_UNAVAILABLE`.
3. **Bước 3 — Success:** SVG tick vẽ animation + **confetti canvas 140 hạt** → ~1.9s vào cổng.

**Đổi PIN bắt buộc (2 tầng):** server trả `mustChangePin: true` khi (a) PIN do HR cấp lần đầu, hoặc (b) **tới chu kỳ đổi PIN 1–5 hàng tháng** (`pin_rotation_cycle`). App treo ở màn đổi PIN: PIN cũ (4–8 số cho legacy) + PIN mới (đúng 6 số, khác cũ) + xác nhận → `POST /auth/employee/change-pin` `{oldPin, newPin}`; token cũ thu hồi → tự login lại bằng PIN mới. **Chống lách bằng reload:** khi mở web luôn `GET /me` xác minh phiên; nếu `mustChangePin` → treo lại màn đổi PIN; giữa phiên gặp `403 PIN_CHANGE_REQUIRED` → khóa toàn bộ cổng (banner "🔒 Tài khoản chưa đổi mã PIN mới theo chu kỳ!").

**Cơ chế nền:**
- **Update banner bắt buộc:** mỗi 5 phút + mỗi lần tab visible, fetch lại `index.html` (`no-store`), hash nội dung (djb2); hash đổi → overlay full-screen "CÓ BẢN CẬP NHẬT MỚI — BẮT BUỘC CẬP NHẬT", khóa mọi chức năng, chỉ có "Cập nhật ngay" (reload). Kèm `GET /version` hiển thị commit API.
- **Màn bảo trì:** `GET /public/portal-maintenance`; nếu `system_maintenance`/`employee_web_maintenance` bật → toàn màn "Cổng nhân viên tạm khóa", hiện message từ Admin, poll lại 30s; socket `config` cập nhật tức thì.
- **Cờ mất mạng:** 4 nhóm API tải dữ liệu fail → banner đỏ "📡 Mất kết nối máy chủ — đang hiển thị dữ liệu cũ".
- Token: `ubm_emp_token`, `ubm_emp_refresh`; hồ sơ `ubm_emp_data`; tab `ubm_emp_active_tab`.

## 7.2. Cấu trúc 10 tab (khác nhau theo giai đoạn)

**NV THỬ VIỆC (PROBATION):** 1. Trang chủ · 2. Lịch thử việc · 3. Đăng ký OFF thử việc · 4. Điểm danh · 5. Công của tôi · 6. Tự đổi ca / Nghỉ khẩn · 7. Bổ sung công · 8. Thi TEST · 9. Thông báo & Lương · 10. Hồ Sơ

**NV CHÍNH THỨC:** 1. Trang chủ · 2. Lịch làm việc · 3. Đăng ký OFF tuần · 4. Điểm danh · 5. Công của tôi · 6. Đổi ca làm · 7. Nghỉ khẩn & Bổ sung công · 8. TEST / Đào tạo · 9. Thông báo & Lương · 10. Hồ Sơ

Header sticky: logo, họ tên, badge "Thử việc (12 ngày)"/"Chính thức", mã NV + chi nhánh, nút đăng xuất. Sub-bar tab cuộn ngang.

**Gate chu kỳ OFF:** NV chính thức đang trong cổng đăng ký 2 ngày OFF/tuần mà chưa đăng ký → bấm tab nào cũng bị đẩy về tab 3 ("QUY CHẾ BẮT BUỘC…"), banner đỏ trên mọi tab + nút "ĐĂNG KÝ 2 NGÀY NGHỈ OFF NGAY". Trạng thái ưu tiên từ server `GET /me/weekly-off-status`, offline dùng cờ localStorage theo tuần `{[weekMonday]: true}` (hỗ trợ đợt mở bù VIP cho tuần sau).

## 7.3. Chi tiết từng tab

### Tab 1 — TRANG CHỦ (`home`)
- **Banner kiểm tra đầu ra thử việc** (NV thử việc khi HR đã lên lịch): đếm ngược tới buổi vấn đáp Google Meet (ngày + giờ + URL → nút "🎥 Vào Meet vấn đáp"), trạng thái bài trắc nghiệm (chưa làm → "📝 Làm bài trắc nghiệm" nhảy tab 8; đã nộp → điểm /10), ngày hoàn thành thử việc. API `GET /me/probation-assessment`.
- **Card ca hôm nay:** chỉ ca PUBLISHED (ca DRAFT báo riêng); trạng thái realtime cập nhật mỗi 30s: `● Đang trong ca` / `⏳ Ca sắp tới` / `✓ Ca đã xong` / "😴 Hôm nay không có ca"; nhiều ca hiển thị "(hôm nay bạn có N ca)"; yêu cầu đồng phục áo hồng + bảng tên, có mặt trước 15 phút. 2 nút: "ĐIỂM DANH NGAY" (→ tab 4) và "Xem Lịch" (→ tab 2).
- **2 card tóm tắt:** Giai đoạn (Thử Việc ngày X/12 / Chính thức) + **Đơn giá lương đ/h** (`current_rate_per_hour`, fallback 23k TV / 25k CT).
- **3 nút nhanh:** Đăng ký OFF / Đổi Ca Làm / Thi TEST (điều hướng theo loại NV). API `GET /me/schedule`.

### Tab 2 — LỊCH LÀM VIỆC (`schedule`)
- **NV chính thức:** dải **T2–CN của "Tuần này"/"Tuần sau"** (2 nút chuyển; tự mở tuần sau khi HR vừa publish; realtime `schedule.published` tự chuyển tuần + toast). KPI 3 thẻ: số ca làm (~giờ dự kiến), số ngày OFF, trạng thái hôm nay. Dải lịch strip 7 ô (chạm cuộn tới ngày); bộ lọc Tất cả / 💼 Có Ca / 🌴 Nghỉ OFF.
- **Thẻ từng ngày:** hôm nay viền hồng + tag HÔM NAY; hiển thị (1) thẻ đơn OFF (THU_VIEC / HANG_TUAN / DOT_XUAT + trạng thái), (2) thẻ ca làm — meta ca (Ca 1 Sáng 07:00–12:00 ☀️ / Ca 2 Chiều 12:00–18:00 🌤️ / Ca 3 Tối 18:00–23:00 🌙), **tên chi nhánh đầy đủ** (CN130 → "CN1: 130 Vạn Kiếp (Bình Thạnh)", CN261 → Tô Hiến Thành Q.10, CN120 → Hoàng Diệu 2 Thủ Đức, CN111 → Tôn Đản Q.4, VAN_PHONG, XUONG_SX), thanh trạng thái chấm công: ✓ Đã hoàn thành / ▶ Đang làm / ⚠️ Thiếu check-out / 🔴 Vắng không phép / 🔒 Đã khóa ca (quá 3h) / ⏱️ Ca hôm nay / Chưa điểm danh. Ca trùng mã gộp thẻ (`_mergedAids`); thẻ ma <30p lệch giờ in bị ẩn; ngày chỉ có ca nháp → banner vàng "chờ HR phát hành".
- **NV thử việc:** dải **12 ngày từ start_date** (MỐC 1 = ngày đầu), banner cảnh báo "đang đẩy nhanh" nếu có ngày 2 ca (`shiftDensityOf`), banner ngày hoàn thành thử việc.
- API: `GET /me/schedule?fromDate=&toDate=`, `GET /leave-requests?employeeId=`, realtime `schedRefresh`.

### Tab 3 — ĐĂNG KỴ OFF (`leave`)
- **Thử việc — lưới chọn 5 ngày OFF trong 12 ngày** (quy chế 7 làm / 5 OFF): grid 12 ô ngày (ô hôm nay/quá khứ khóa 🔒), chọn đúng 5 → "XÁC NHẬN 5 NGÀY OFF & TỰ XẾP 7 CA LÀM" (confirm "không đổi lại được") → `POST /leaves/probation-off` `{dates[5]}` → server trả `offDates + workDates` (**tự xếp 7 ca**). Chỉ 1 lần duy nhất (muốn đổi liên hệ Store/HR).
- **Chính thức — 2 ngày OFF/tuần (BẮT BUỘC, gate mở khóa app):** cổng chỉ mở **T6 09:00 → T7 09:00** (server điều khiển: `GET /me/weekly-off-status` + `GET /api/weekly-off-window` — phase `REMINDER|OPEN`, `windowOpensAt/windowClosesAt`, hỗ trợ **đợt mở bù thủ công của Admin**, thông báo trước 5 phút). Ngoài khung: màn khóa "🔒 CHƯA ĐẾN GIỜ MỞ ĐĂNG KÝ" + nút xem giờ mở. Trong khung: 2 input date (khác nhau, trong tuần mục tiêu) + lý do → `PUT /leaves/weekly-off` `{day1, day2, reason}` (**API nguyên tử 2 ngày 1 request**). Luật chống trống ca: 2 bạn cùng ca cùng chi nhánh không được OFF chung ngày (server chặn). Đăng ký xong khóa cứng (1 lần/tuần), mở khóa mọi tab. Lỗi: `WEEKLY_OFF_REGISTRATION_REQUIRED, WEEKLY_OFF_WINDOW_CLOSED, WEEKLY_OFF_MUST_REGISTER_2_DAYS`.
- Form cũ `POST /leaves` chỉ còn cho loại ≠ `HANG_TUAN` (loại HANG_TUAN bị chặn — phải đi qua cổng 2 ngày OFF).

### Tab 4 — ĐIỂM DANH (`attendance`) ⭐ tính năng trung tâm
- **Không có ca hôm nay → khóa chức năng** (thẻ khóa + nút kiểm tra lại lịch); chỉ có ca DRAFT → báo "HR chưa phát hành".
- **Ngày 2 ca** (do tráo đổi/nhận thay): dropdown chọn đúng ca (mặc định ca đang diễn ra).
- **Ràng buộc:** check-in mở trước giờ ca 30 phút (sớm hơn → disabled + hiện giờ mở); check-out chỉ từ giờ tan ca (chặn cứng client + server); **ca khóa** quá 3h không check-in (nghỉ không lương); bắt buộc check-in trước check-out (từng ca).
- **Quy trình 5 bước** (state machine `IDLE → CHECKING_GPS → READY_CAMERA → SUBMITTING → CONFIRMED`):
  1. **GPS THẬT 100%** `navigator.geolocation` (highAccuracy, timeout 15s): từ chối quyền / mất sóng / quá hạn → dừng. Hiển thị độ chính xác ±m (chuẩn <300m).
  2. **Chụp ảnh camera thật** (`<input type=file capture="environment">`): nén trên máy (cạnh dài 1280px, JPEG giảm dần tới ≤800KB).
  3. **Kiểm tra đồng phục áo hồng trên máy** (Canvas phân tích HSV: hồng bụi H≈285°–12°, saturation >0.18, cần ≥10% khung hình; **NV thử việc được miễn**) → `% hồng` gửi kèm `uniform_pink_ratio`. NV chính thức tick 2 checkbox "mặc Áo Hồng Ụm Bò Milk" + "đeo Bảng Tên".
  4. Gửi `POST /attendance/checkin` / `POST /attendance/checkout` `{assignment_id, lat, lng, accuracy, photo_base64?, uniform_pink_ratio?}` (check-out không cần ảnh).
  5. **Màn xác nhận:** thời gian, `receipt.distance_meters`, cảnh báo `OUT_OF_BOUNDS` nếu GPS ngoài 300m (vẫn ghi nhận để đối soát); sau check-in lại do GPS vượt 300m → banner "bắt điểm danh lại" tự tắt (POST read).
- Nút bấm đúp chặn bằng guard đồng bộ (`attendBusyRef`).

### Tab 5 — CÔNG CỦA TÔI (`timesheet`)
- Chọn tháng (chu kỳ lương, ◀ ▶ + "Tháng này") — tải `GET /me/schedule?fromDate=&toDate=`, `GET /me/attendance?fromDate=&toDate=`, `GET /me/monthly-timesheet?period=YYYY-MM`.
- **6 thẻ tổng hợp:** Đủ công / Đang làm / Thiếu check-out / Vắng–Không điểm danh / **Tổng phạt tháng** / **Lương tháng** (ưu tiên số server `totals.deduction`, `totals.netPay` — **khớp 100% công thức Bảng Tổng Hợp Finance**).
- **Thẻ từng ngày có ca:** mỗi ca 1 dòng — tên ca + khung giờ, Vào/Ra (giờ VN), badge theo `attShiftStatus` của `@ubm/shared`: ⏳ Chờ duyệt (DRAFT — không tính công) / ✓ Đủ công (+ tiền ca server) / Đang làm / Thiếu check-out — không lương / 🔴 Vắng / Không điểm danh — nghỉ không lương / Lịch đã duyệt. Ghi chú: Trễ Xp / Về sớm Xp / mức phạt (`FLAT_30K|HALF_SHIFT|FULL_SHIFT`) / GPS vượt 300m / tự ghi vắng / tiền ca theo giai đoạn TV/CT.
- **Thẻ "Ngoài lịch (tự điểm danh)":** gộp check-in mồ côi (`mergeOrphanCheckins`), suy mã ca từ giờ vào (`inferExtraShiftCode`), tạm tính tiền (`shiftPayInfo`). Nút "YÊU CẦU BỔ SUNG CÔNG KHI SAI SÓT" → tab 7. Ca CANCELLED bị ẩn.

### Tab 6 — ĐỔI CA
**Thử việc (`swap_emergency`) — 3 khối:**
1. **Tự đổi ca cá nhân (tự duyệt ngay, không cần HR):** chọn ngày + chiều chuyển (`CA LÀM ➔ NGHỈ OFF` / `NGHỈ OFF ➔ ĐI LÀM Ca Sáng 07:00–12:00`) + lý do → `POST /me/probation-self-swap` `{direction, date, reason, shiftCode?}` — lịch + công cập nhật ngay.
2. **⚡ Tự thêm ca đẩy nhanh:** chọn ngày (min hôm nay, max cuối kỳ thử việc) + ca (CA_1/2/3); ngày đã đủ 2 ca thì chặn; **hiệu lực ngay, không HR duyệt, tối đa 2 ca/ngày** (quá → `MAX_2_SHIFTS_PER_DAY` + báo HR) → `POST /me/probation-extra-shift` `{date, shiftCode}`.
3. **🚨 Báo Nghỉ Đột Xuất (mặc định ẨN):** chỉ hiện khi Admin/HR **kích hoạt 1 lượt duy nhất** (`GET /me/emergency-leave-status` → `{enabled}`); nhập lý do → `POST /leaves` `{leaveType: 'DOT_XUAT', requestedDate, reason: '[NGHỈ KHẨN CẤP] …'}`; gửi xong lượt tiêu thụ, tự ẩn (`EMERGENCY_LEAVE_NOT_GRANTED`).

**Chính thức (`swap_shift`) — 4 khối:**
1. **Phiếu chờ TÔI xác nhận** (banner vàng mọi tab + thẻ): đồng nghiệp tráo ca hoặc **HR điều phối làm thay** → ✓ Đồng ý / ✕ Từ chối → `POST /swap-requests/:swapId/respond` `{accept}`; **B đồng ý là 2 ca hoán đổi ngay (không cần HR duyệt)**; với `HR_SUPPORT` đồng ý là ca tạo ngay ở CN hỗ trợ.
2. **🚀 Ca cần người làm thay (+30.000đ — `HR_DISPATCH`):** mở cho cả chi nhánh, nút "Nhận ca này" / "Ẩn (không nhận)".
3. **Phiếu tôi đã gửi:** Chờ NV B / Chờ Store duyệt / Đã duyệt / Từ chối / Đã hủy.
4. **Form gửi 2 hình thức:** (1) **Tráo đổi ca A ⇄ B** — chọn ca của mình → chọn đồng nghiệp cùng chi nhánh (`GET /me/colleagues`) → tải ca thật của B `GET /me/colleague-shifts?employeeId=&fromDate=` (fallback `/schedules?branchId=&week=`) → chọn ca B + lý do; (2) **Nhờ làm thay / Nhường ca** (B làm 2 ca/ngày, `targetAssignmentId: ''`). Chỉ chọn được ca **PUBLISHED** từ tuần hiện tại trở đi (DRAFT/quá tuần bị chặn — cảnh báo đếm ca chưa publish). Gửi: `POST /swap-requests` `{requesterAssignmentId, targetEmployeeId, targetAssignmentId, reason}`. Realtime `swap.updated` báo từng trạng thái.

### Tab 7 — BỔ SUNG CÔNG / NGHỈ KHẨN (`adjustment` | `emergency_adjust`)
- Form: **Ngày sự cố** (tải riêng ca đúng ngày `GET /me/schedule?fromDate=d&toDate=d` — ngày không có ca **chặn gửi**; ngày 2 ca phải chọn đúng ca), **Loại:** `QUEN_CHECKIN` (duyệt = ghi check-in), `QUEN_CHECKOUT`, `BU_CONG_NGAY` (bù cả ngày, **tốn 5 điểm bù công** — hiện số dư: tích 1 ca check-in+out = +2 điểm từ `adjust_points_earned/spent`), lý do + **ảnh bằng chứng** (không bắt buộc, nén ≤800KB, upload Drive — chỉ lưu Drive ID).
- **Khung giờ tạo phiếu: 08:00–21:00 hằng ngày** (giờ VN) — ngoài giờ khóa nút.
- Gửi: `POST /attendance/adjustments` `{assignmentId, incidentDate, reason: '[TYPE] date: reason', minutesRequested: 0, photo_base64?}`; chọn NGHỈ KHẨN → `POST /leaves` loại `DOT_XUAT`.
- **Phiếu của tôi** (`GET /attendance/adjustments`, poll 15s + realtime): Chờ duyệt / Đã duyệt / Bị từ chối / **Tự động từ chối (HR quá 30 phút chưa duyệt)**; xem ảnh bằng chứng (`MyAdjPhoto` fetch blob + Bearer: `GET /attendance/adjustments/:id/photo`); phiếu PENDING được **🗑 Hủy** → `DELETE /attendance/adjustments/:id`. Quy định: quá 30 phút tự từ chối, giữ 7 ngày rồi xóa.

### Tab 8 — THI TEST / ĐÀO TẠO (`test_exam` | `test_training`)
- Danh sách bài TEST **HR giao riêng** (`GET /me/tests`): tiêu đề, mô tả, số câu, trạng thái (Chờ làm / điểm X/10 Đạt–Chưa đạt theo `pass_score` mặc định 8).
- **Làm bài:** "Bắt đầu làm bài (time_limit 480s mặc định)" → đếm ngược từng giây (đỏ <60s, **hết giờ tự nộp đúng 1 lần** — chống spam), radio A/B/C/D từng câu, nộp có confirm nếu còn câu bỏ trống → `POST /me/tests/:submissionId/submit` `{answers: number[]}` → server chấm /10, Đạt/Chưa đạt, toast điểm.

### Tab 9 — THÔNG BÁO & LƯƠNG (`notifs_salary`)
- **Hộp thư:** tối đa 20 tin mới (`GET /me/notifications`); lọc client: ẩn tin nhắc check-in lặp, ẩn tin feed ALL của NV khác (giữ tin đích danh mình hoặc tin chung lịch/PIN/OFF/marketing); bấm tin = **đã đọc** `POST /me/notifications/:inboxId/read` + **deep-link tới đúng tab** (`target_path`: /schedule, /home, /attendance, /leave, /test_exam, /test_training, /adjustment; tin `schedule.published` tự mở đúng tuần mới publish).
- **Phiếu lương bảo mật:** màn khóa ban đầu → "Xem Phiếu Lương Của Tôi" → `GET /me/payslips` (server lọc đúng NV). Badge: 🔔 Chờ ký nhận (PUBLISHED) / ✍️ Đã ký (CONFIRMED) / 🎉 Đã thanh toán (PAID). Breakdown: công (giờ, số ca, ca vắng × đơn giá snapshot), Lương cơ bản, Phụ cấp OT (số suất), OT thêm, Bonus, **TỔNG CỘNG**, Trừ KPI + phạt, Ứng lương, Trừ đồng phục, **THỰC LÃNH** to đùng.
- **Ký nhận chữ ký tay:** khi PUBLISHED → khối "XÁC NHẬN SỐ TIỀN THỰC LÃNH" → **SignaturePad** (vẽ ngón tay/chuột canvas 440×180, retina-aware, PNG dataURL + họ tên) → `POST /me/payslips/:slipId/confirm` `{name, img}` → CONFIRMED + thông báo Kế toán chuyển khoản; hiển thị đủ **3 chữ ký điện tử đối soát** (Người Lập Phiếu / Quản Lý Chi Nhánh / Người Nhận Tiền). PAID → hiện thời gian xác nhận chuyển khoản. Realtime: Kế toán phát hành phiếu mới → tự tải + toast "💰 Kế toán vừa phát hành phiếu lương mới!". Nút "Ẩn Phiếu Lương".

### Tab 10 — HỒ SƠ CÁ NHÂN (`profile`)
- **Khối chỉ xem (HR quản lý):** Họ tên, Mã NV, SĐT (tài khoản), Chi nhánh, Trạng thái (Thử việc/Chính thức), Đơn giá đ/h, Ngày vào làm, Ngày chính thức.
- **Khối tự cập nhật** (lưu là HR/Kế toán thấy ngay realtime): Email, Giới tính (NAM/NU/KHAC), Ngày sinh, **CCCD**, **Mã QR ngân hàng** — tính năng đặc biệt: tải ảnh QR → **giải mã QR VietQR (EMVCo TLV) bằng `jsqr`** (thử toàn ảnh + cắt vùng trung tâm nhiều độ phân giải) → tự điền `bank_name` (tra mã BIN 6 số → 30 ngân hàng VN), `bank_account`, `bank_holder`; QR thiếu trường → **OCR fallback `tesseract.js`** đọc thẻ (nhận diện 27 ngân hàng + STK 8–19 chữ + chủ TK khớp tên NV/họ VN, chống rác OCR); đủ 3 trường + ảnh nén ≤45KB (480px) → `PUT /me/profile` `{email, gender, birth_date, id_card_number, bank_name, bank_account, bank_holder, bank_qr_img}`. Nút Đổi ảnh QR / Gỡ QR.

### Banner nền luôn hiển thị khi đã đăng nhập
Banner REMINDER (sắp mở cổng OFF) · banner đang trong thời gian đăng ký 2 ngày OFF · banner đã hoàn thành đăng ký · **banner bắt điểm danh lại (GPS vượt 300m)** — hiện mọi tab, nút "Điểm danh lại ngay" / "Để sau" (POST read) · banner phiếu đổi ca chờ xác nhận.

---

# 8. THƯ VIỆN DÙNG CHUNG `@ubm/shared`

- Re-export từ `src/index.ts`: `types/{roles, accounts, employees, schedules, attendance, payroll, notifications, operations, tests}` + `constants` + `attendance-grid`.
- **`attendance-grid.ts` — module logic lưới chấm công dùng chung 2 cổng** (Admin "Bảng Chấm Công Thời Gian Thực" + Employee "Dữ Liệu Công Của Tôi") để trạng thái ca + lương/phạt tạm tính **khớp 100% realtime** (Finance vẫn chốt số chính thức ở kỳ lương):
  - `vnDayOf(iso)` — ngày VN (UTC+7) của mốc ISO (tránh lệch ngày 00:00–07:00).
  - `attShiftStatus(shift, inEvt, outEvt, absentEvt)` — `COMPLETED` / `MISSING_OUT` (chốt cứng cho ngày đã qua) / `ABSENT` / `LOCKED` / `UPCOMING` / `CHECKED_IN` (blink) / `PENDING` + màu bg/fg/border + cờ blink + phút trễ.
  - `mergeOrphanCheckins(...)` — gộp điểm danh "mồ côi" vào ca live còn thiếu check-in khi giờ vào lọt khung (vào sớm 60p → tan +30p).
  - `SHIFT_HOURS_MAP = {CA_1:5, CA_2:6, CA_3:5}`; `TV_RATE_VND = 21000`; `rateOnDateOf(emp, day)` — đúng giai đoạn (ngày trước `official_date` tính giá thử việc).
  - `lateMinOf(inEvt, shiftStartAt)` — phút trễ (ưu tiên cờ server).
  - `inferExtraShiftCode(inEvt, defaultShift)` — suy ca ngoài lịch: 5–11h30 → CA_1, 11h30–17h30 → CA_2, còn lại CA_3.
  - `shiftPayInfo(shiftCode, rate, inEvt, outEvt, shiftStartAt)` — lương + phạt 1 ca: thiếu in/out → 0đ; trễ <5p không phạt; 5–29p → 30.000đ; 30–59p → 50% lương ca; ≥60p → 100% (không lương). Trả `{hours, rate, shiftPay, lateMin, fineLabel, deduction, net, unpaid}`.
- **DESIGN_TOKENS:** bảng màu/radius/shadow/transition dùng chung 2 cổng (hồng `#E85D92`).

---

# 9. DESIGN SYSTEM (cả 2 cổng dùng chung tinh thần)

- Theme hồng thương hiệu `--brand: #E85D92` trên nền `#FFF8F4`, font **Plus Jakarta Sans**; success `#10B981`, warning `#F59E0B`, danger `#EF4444`; radius 8/12/16/20px; tương phản ≥4.5:1; vùng chạm mobile ≥44×44px; **không có dark mode** (light duy nhất), tôn trọng `prefers-reduced-motion`.
- **Micro-interaction CSS (`index.css`):** `fx-ripple` (nút), `fx-loading` (spinner), `fx-shake` (lỗi), `fx-pop` (thành công), `fx-fade-up` + `--fx-delay` (entrance so le), `fx-skeleton` (shimmer), `fx-pulse-dot`/`fx-blink` (realtime), `.ubm-sticky-tbl` (bảng dính tiêu đề, max-height 72vh), toast + progress bar, bell shake, pulse glow.
- Employee-web: mobile-first `#root max-width 480px`, card bo 20px, step bar 3 đoạn, orb blur nền — nhìn như app điện thoại.
- Favicon `/logo.jpg`; tiêu đề index.html "Ụm Bò Milk - Cổng Nhân Viên V5.1"; meta Zalo site verification; viewport khóa zoom.

---

# 10. REALTIME — SOCKET.IO EVENTS

## 10.1. Kết nối

- Socket.IO 4.8.1, auth `{token}`, transports websocket + polling, reconnect backoff **2s → 15s, tối đa 8 lần thử** (employee-web: quá 8 lỗi liên tiếp → ngắt + `onGiveUp`, **tự hồi sinh mỗi 60s** vì server free-tier hay ngủ); handshake 15s; lỗi `AUTHENTICATION_ERROR` → tự refresh token/khởi tạo lại, không đếm lỗi.
- **Nguyên tắc:** socket chỉ là "delivery nhanh, không phải sự thật duy nhất" — client nhận event mới GET snapshot + so version; không lưu dữ liệu chính trong socket hay localStorage.

## 10.2. Event client lắng nghe

`data:updated(entity)` (reload debounce 1s theo entity: schedules/attendance/payslips/employees/all/config) · `notification.created` · `system:notification` (chỉ popup tin từ phía ADMIN/HR) · `schedule.published` (tự chuyển tuần mới + toast) · `swap.updated` (phiếu đổi ca qua từng trạng thái) · `attendance.recorded` · `payroll.published` · `admin:forceLogout` · `config` (bảo trì) · `employees / accounts / candidates / employees:locked / employees:unlocked` (admin-web).

## 10.3. Window events nội bộ (đồng bộ giữa các tab component admin)

`ubm:attendance-reload, ubm:reports-reload, ubm:fin-timesheet-reload, ubm:swaps-reload, ubm:schedule-reload, ubm:adjustments-reload, ubm:tests-reload, ubm:candidates-reload, ubm:employees-reload, ubm:interview-draft-reload, ubm:payslips-reload, ubm:employee-locked, ubm:employee-unlocked`.

## 10.4. Đồng bộ chéo 2 cổng (tính năng độc đáo)

QR ngân hàng NV gửi ở Hồ sơ → hiện ngay tab `fin-bank-qr` kế toán; NV điểm danh → `attendance.recorded` → lưới lịch admin cập nhật tức thì; Kế toán phát phiếu lương → NV nhận toast realtime; khóa TK → NV văng phiên ngay.

---

# 11. QUY TẮC NGHIỆP VỤ CỐT LÕI (bắt buộc tuân thủ khi tái tạo)

1. **Chỉ ca `PUBLISHED`** là lịch chính thức — được điểm danh, được đổi, được tính công.
2. **Điểm danh:** GPS thật + ảnh camera thật + đồng phục hồng ≥10% + bảng tên; check-in mở trước ca 30 phút; khóa ca sau 3h; phạt trễ theo tier (0 / 30k / 50% / 100%); GPS ngoài bán kính vẫn ghi nhận nhưng đánh dấu `OUT_OF_BOUNDS` + bắt NV điểm danh lại; event gốc bất biến.
3. **Thử việc 12 ngày:** NV tự chọn 5 ngày OFF **một lần duy nhất**, hệ thống tự xếp 7 ca; tự đổi ca + tự thêm ca (≤2 ca/ngày) không cần HR duyệt.
4. **Chính thức:** 2 ngày OFF/tuần đăng ký trong cổng T6 09:00 → T7 09:00 (1 lần/tuần, khóa app đến khi đăng ký); 2 bạn cùng ca cùng chi nhánh không OFF chung ngày; có đợt mở bù của Admin.
5. **Đổi ca:** A gửi → B xác nhận = hoán đổi ngay; `HR_DISPATCH` +30.000đ; `HR_SUPPORT` tạo ca ngay ở CN hỗ trợ; phiếu sai tuần tự hủy (`audit-out-of-week`).
6. **Điều chỉnh công:** 1 phiếu/tuần, tự từ chối sau 30 phút, tự xóa sau 7 ngày, `BU_CONG_NGAY` tốn 5 điểm bù công; duyệt → backfill công + xóa vi phạm trễ.
7. **Lương:** stage `DRAFT → RECONCILED → APPROVED → PUBLISHED → PAID`; **tách biệt người tính/người duyệt**; công thức Excel hóa (rateTV/rateCT/otPerSlot/otThreshold 10h–15h) + 6 cột nhập tay + live payslip; phiếu PUBLISHED đủ **3 chữ ký** (lap/quanly/nhanvien) mới thành `CONFIRMED` → chi trả (`PAID`) qua **VietQR** (nội dung CK = "LUONG {period} {mã NV}"); phiếu đã phát không sửa đè — sai thì revision/adjustment.
8. **Optimistic locking:** mọi PUT employee/chuyển trạng thái gửi `expectedVersion`; xung đột → `VERSION_CONFLICT`.
9. **Bảo mật:** JWT access 8h + refresh 7d; forceLogout từ xa; khóa TK → văng phiên + xóa PIN + xóa ca; mật khẩu/PIN bcrypt, không lưu thô; SĐT + PIN 6 số bắt đổi theo chu kỳ 1–5 hàng tháng; rate limit auth + chung.
10. **Tuyển dụng:** không tự loại ứng viên theo năm sinh/quê/Facebook; AI score thang 14 (đạt ≥8) chỉ tham khảo; rubric PASS ≥12/13; mời qua Zalo cá nhân HR + Meet.
11. **Thông báo:** outbox/inbox, dedupe, severity, target_path deep-link; tin quan trọng phải có lịch sử (Sheets), không chỉ phụ thuộc socket; không gửi tiền lương chi tiết/GPS/ảnh/SĐT vào kênh công khai.

---

# 12. TRIỂN KHAI, DOCKER, CI/CD, ENV

## 12.1. Chạy local

Node 18.x/20.x, npm 9/10: `npm install` → `npm run build` → `npm run dev:backend` (4005) / `dev:admin` (3005) / `dev:employee` (3006).

## 12.2. Tài khoản seed demo (mock adapter / dev)

`admin / Master@@2027` (nhánh `vps`: `admin / Nguyenthanhthien@9999` qua `ADMIN_SEED_PASSWORD`), `hr_lead / hr123`, `store_130 / store123`, `finance_lead / fin123`, `mkt_lead / mkt123`; nhân viên demo: `0901111222` (Nguyễn Văn An, CN130, thử việc), `0903333444` (Trần Thị Bình, CN130, chính thức).

## 12.3. Deploy production (nhánh `vps`)

- **VPS riêng (Docker + Nginx + SSL):** `deploy/vps/.env.vps.example` → copy thành `apps/backend/.env`; `docker compose up --build -d`; healthcheck `GET /health` (status UP, `sheetsStatus.mode: GOOGLE_SHEETS_LIVE`); image **all-in-one** serve backend + 2 web dist; restart unless-stopped. **Bắt buộc HTTPS** để dùng Camera/GPS.
- Env bắt buộc: `GOOGLE_SERVICE_ACCOUNT_JSON`, `SPREADSHEET_ID`, `CANDIDATE_SPREADSHEET_ID`, `GOOGLE_DRIVE_FOLDER_ID`, `JWT_SECRET` (openssl rand -hex 32), `CORS_ORIGINS`, `JWT_ACCESS_TTL/JWT_REFRESH_TTL`, `ADMIN_SEED_PASSWORD`, `AUTH_RATE_LIMIT_MAX/GENERAL_RATE_LIMIT_MAX`, `SHEETS_SYNC_INTERVAL_MS`, `PORT`, `NODE_ENV=production`.
- Bootstrap: admin seed khi `ADMIN_ACCOUNTS` trống → HR cấp **PIN 4–8 số** cho NV → NV đăng nhập SĐT + PIN → bắt đổi PIN 6 số lần đầu.
- Frontend cũng deploy tĩnh Vercel được (`vercel.json`: rewrite SPA + `Cache-Control: no-cache` cho index.html — phục vụ cơ chế phát hiện bản cập nhật).

## 12.4. CI (.github/workflows/ci.yml)

Trigger mọi push/PR; Node 20.18.0 (theo `.node-version`); job build-and-test: `npm ci` → `npm run build` (cả 4 workspace); job docker: build image `apps/backend/Dockerfile` (context root) → chạy container `JWT_SECRET` + `ADMIN_SEED_PASSWORD=CiAdmin123456` → đợi `/health == UP` (20×3s) → smoke test `POST /auth/admin/login` phải trả token.

## 12.5. Secrets & .gitignore

Không commit: `.env*`, `service-account*.json`, `credentials*.json`, `*.pem`, **`.zalo-session.json`**, `apps/backend/data/` (ảnh local fallback).

---

# 13. TIÊU CHÍ NGHIỆM THU (UAT)

- **AUTH-01→05:** login admin, login NV SĐT+PIN, sai PIN, tài khoản khóa, refresh token.
- **RBAC-01→02:** Store CN130 gọi dữ liệu CN261 ⇒ **403**; MKT không truy cập lương/GPS/ảnh.
- **SCHED-01→02:** lịch DRAFT không điểm danh được; PUBLISH mới có hiệu lực.
- **ATT-01→03:** idempotency check-in (`request_id`); GPS/camera từ chối → không ghi nhận; check-out sớm bị chặn.
- **PAY-01→03:** đơn giá đổi giữa kỳ (TV→CT) tính đúng 2 mảng giờ; người duyệt ≠ người tính; NV không rò phiếu người khác.
- **DATA-01→02:** quota Sheets, backup/restore.
- **UI-01→12:** branchScope, mobile 360px, chống double-click, `NEEDS_RECONCILIATION`, reconnect socket, room theo server, toast không lộ số tiền nhạy cảm, đã đọc ≠ đã xử lý, reduced-motion, camera/GPS bị từ chối, MKT không duyệt, dữ liệu demo gắn nhãn DEMO.
- **Load test giờ vào/ra ca** là bắt buộc.

---
*Hết prompt — tài liệu sinh tự động từ source code dự án UBM HR v1.0.0 (nhánh main) + nhánh vps.*
