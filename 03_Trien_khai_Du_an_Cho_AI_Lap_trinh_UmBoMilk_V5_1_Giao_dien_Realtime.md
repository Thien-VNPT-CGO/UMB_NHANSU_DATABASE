# MASTER IMPLEMENTATION BRIEF — ỤM BÒ MILK HR SYSTEM V5.1 — UI/UX & REALTIME

**Cập nhật:** 23/09/2026 · **Phiên bản:** V5.1 (bổ sung giao diện, hiệu ứng, thông báo) · **Loại tài liệu:** Hướng dẫn giao việc cho AI/đội lập trình · **Trạng thái:** Đặc tả triển khai, CHƯA triển khai sản phẩm thực tế. **Phạm vi thay đổi V5.1:** thêm thiết kế UI/UX, hiệu ứng và thông báo; giữ kiến trúc Sheet-master và nghiệp vụ V5.0.

> NGUYÊN TẮC ƯU TIÊN: Quyết định mới nhất của chủ dự án có hiệu lực cao nhất: (1) **Google Sheets là kho dữ liệu nghiệp vụ có cấu trúc chính**, (2) **2 Web App**: quản trị và nhân viên, (3) nhân viên nhập **SĐT**; backend tra tài khoản trên Google Sheets và chỉ cho vào khi **Admin đã kích hoạt**, (4) 5 vai trò nội bộ Admin / HR / Store / Finance / MKT. Tài liệu V4 có PostgreSQL master; **không sao chép kiến trúc cũ vào mã nguồn V5**. Các quyền ReadOnly và Payroll Approver là permission/role tùy chọn trong Web App quản trị, không tạo app thứ ba.

## 0. Lệnh làm việc cho AI

Bạn là kiến trúc sư và lập trình viên dự án HR nội bộ. Hãy triển khai theo từng giai đoạn, giữ hợp đồng dữ liệu, phân quyền và trạng thái nêu dưới đây. **Không giả vờ rằng API/bot, schema, Google OAuth hoặc chức năng đã hoạt động nếu chưa kiểm thử với tài khoản/quyền thật.** Trước khi sửa Sheets đang chạy: tạo bản sao, chụp lại header, backup, xuất diff migration và chờ phê duyệt. Không tự sửa quy chế pháp lý/tiền lương hoặc tự điền chính sách còn chờ chốt. Không in secrets/API tokens/PIN hoặc thông tin nhân viên thật trong log, tài liệu, fixtures và commit.

### Cần bàn giao sau từng chặng

1. Mã nguồn, hướng dẫn thiết lập môi trường (`.env.example` chỉ chứa tên biến, không chứa giá trị thật), sơ đồ module và danh sách permissions.
2. Bản định nghĩa sheet schemas có version, migration/dry-run, bản snapshot trước/sau, rollback có giới hạn.
3. Unit/integration/e2e tests, đặc biệt test chống trùng, lỗi Google API, phân quyền và trạng thái kích hoạt.
4. Demo thao tác thực tế và báo cáo rõ: đã chạy / mô phỏng / đang bị chặn do thiếu quyền, hạn mức hoặc chính sách.
5. Bộ Design System có tokens và component variants; mockup desktop/mobile; video hoặc ảnh ghi lại các trạng thái loading, thành công, lỗi, offline và thông báo đến. Các chỉ số trong mockup phải gắn nhãn **DEMO**, không giả là dữ liệu thực.
6. Kiểm thử giao diện, bàn phím, trình đọc màn hình, reduced-motion, responsive; báo cáo lỗi và bằng chứng thông báo nhận lại sau reconnect.

## 1. Hệ thống và triển khai

```text
Admin / HR / Store / Finance / MKT  ──► [WEB QUẢN TRỊ]
NV THỬ VIỆC / NV CHÍNH THỨC          ──► [WEB NHÂN VIÊN]
                      │ HTTPS / Socket.IO
                      ▼
           [Node.js backend / policy / API]
                │                  │
         Sheets repository      File service
                │                  │
   [Google Sheets MASTER]     [Google Drive ảnh/tệp]
                │
         Audit + operation log + outbox (trong Google Sheets)
```

- Frontend đề xuất: **React + TypeScript + Vite**, Tailwind CSS, **shadcn/ui + Radix UI**, Lucide React, Motion for React, Recharts, TanStack Table, TanStack Query, Sonner (hoặc stack tương đương có tài liệu bàn giao). Dùng chung gói `ui`/design tokens cho cả hai Web App, nhưng **không chia sẻ quyền truy cập API theo giao diện**. Không thay stack đang vận hành nếu chưa khảo sát và được phê duyệt.
- Backend: Node.js + TypeScript, API có schema validation, Socket.IO; jobs định kỳ gắn trạng thái và retry. **Không bắt buộc Web App phải viết bằng Python**; nếu sau này thêm Python desktop, nó gọi API chung, không ghi thẳng Sheet.
- Ở MVP chạy **một instance writer** duy nhất với hàng đợi ghi tuần tự. Không mở thêm nhiều worker ghi song song vào cùng tab. Nếu cần scale nhiều writer, lập đề án khóa phân tán và tính nhất quán riêng, không mặc định Google Sheets có transaction/unique constraint hay so sánh-và-hoán-đổi nguyên tử.
- HTTPS; secret Google service account/OAuth lưu trong secret manager hoặc cấu hình server bảo vệ, không đưa vào Sheet/frontend/repo. Các tệp ảnh/GPS và phiếu lương là dữ liệu giới hạn truy cập.
- Socket thông báo **sau khi Sheets xác nhận ghi**; client reconnect phải GET snapshot, so version. Không lưu dữ liệu chính trong Socket hay localStorage.
- Nếu Sheets/Drive mất kết nối: phản hồi `PENDING` hoặc `FAILED` phù hợp; không phát `SUCCESS`, không tính công/duyệt lịch/lương mới dựa vào thao tác chưa được xác nhận. Có đường ghi công dự phòng do Store/HR lập biên bản và đối soát.

## 2. Nguồn dữ liệu thực tế đã đối chiếu

- Master hiện hữu: `https://docs.google.com/spreadsheets/d/17iXM0zc1m17aX9AZrFMjOkPRMy2_CwWfjTRZSUPQF2w/edit`, tiêu đề `UMB_NHANSU_SYNC`, **23 tab** theo metadata đã kiểm tra trong lượt V4.
- Google Form ứng viên: `https://docs.google.com/spreadsheets/d/1rcqEKraSRhr-Tn9qwlhADlkQUei8j65bXeHF_Tmkd38/edit`, tab `FROM_NHAN_VIEN`.
- File lương liên kết: `https://docs.google.com/spreadsheets/d/1YynMAxLgf005ghoIYPvtMrKTMr6QqmUtsuB9MkLf__k/edit`; vùng đầu tab `Trang tính1` chưa có tiêu đề lúc kiểm tra, **chưa được coi là payroll master**.
- Ngân hàng đề TEST dẫn trong tài liệu gốc từng trả 404 trong lượt kiểm tra V4: yêu cầu chủ sở hữu xác minh ID/quyền trước khi tích hợp.
- Các tab master hiện có: `NHAN_VIEN_MOI`, `NHAN_VIEN_TRAINING`, `NHAN_VIEN_CHINH_THUC`, `LICH_PHONG_VAN`, `LICH_LAM_VIEC`, `NHAN_VIEN_XUONG`, `NHAN_VIEN_VAN_PHONG`, `NHAN_VIEN_SALE`, `PHIEU_OFF_DOT_XUAT`, `PHIEU_OFF_HANG_TUAN`, `PHIEU_DOI_CA_TRAINING`, `PHIEU_DOI_CA_OFFICIAL`, `RECORD_DIEM_DANH`, `BAO_CAO_CHAM_CONG`, `KHOA_TEST`, `LICH_TEST_DAU_RA`, `KET_QUA_TEST`, `PHIEU_DOI_THIET_BI`, `RECORD_ZALO`, `AUDIT_LOG`, `SYNC_QUEUE`, `DRIVE_FILES`, `TAI_KHOAN`.
- **Lỗi có sẵn phải migration:** `AUDIT_LOG` có hai bộ tiêu đề tương đương trên cùng hàng; `TAI_KHOAN` có cột `MÃ PIN` không được tiếp tục lưu PIN thô; `NHAN_VIEN_TRAINING`/`CHINH_THUC` có “Khóa” cần bỏ khỏi dữ liệu chia sẻ rộng. Không tự xóa dữ liệu hiện hữu khi sửa tiêu đề.

## 3. Quy tắc Sheet-master bắt buộc

### 3.1. Thiết kế dữ liệu

- Mỗi thực thể: `id` bất biến (UUID, string), `version` nguyên tăng, `created_at`, `updated_at` ISO 8601 UTC, `updated_by`, `record_status` phù hợp. Không lấy chỉ số hàng làm ID. Không dùng họ tên, SĐT, ngày sinh hay mã chi nhánh làm khóa chính.
- `employee_id` bất biến xuyên thử việc/chính thức/đổi chi nhánh; `employee_code` duy nhất (ví dụ `UBM_NV000001`) được cấp qua một writer kiểm soát; chống cấp lại trong retry. SĐT chuẩn hóa riêng, cập nhật có lịch sử.
- Chỉ backend/service identity được ghi master; các tài khoản đọc báo cáo phải giới hạn quyền Sheet. Nếu bắt buộc HR nhập trực tiếp một tab, quy định rõ cột inbound, validator và cơ chế phát hiện sửa tay; không cho sửa các tab trạng thái tài khoản/lương/audit.
- Sheet nhạy cảm chia thành file hoặc vùng quyền riêng được phê duyệt; protected range trong cùng file không thay thế kiểm soát quyền truy cập tệp. Phiếu lương có thể ở file riêng chỉ cấp Finance/approver; nhân viên đọc bằng API sau kiểm quyền `employee_id`.
- Không yêu cầu Google Sheets lưu **tất cả byte**: ảnh/tệp lưu Google Drive, secrets và phiên xác thực lưu server/secret manager. Sheets là nơi dữ liệu **nghiệp vụ có cấu trúc** được lưu chuẩn.

### 3.2. Những tab cần bổ sung (đề xuất, chưa migration)

| Tab mới | Khóa và cột cần có | Công dụng |
|---|---|---|
| `NHAN_VIEN_MASTER` | `employee_id, employee_code, full_name, phone_normalized, employment_status, group, created_at, version` | Danh tính duy nhất. |
| `TAI_KHOAN_NHAN_VIEN` | `account_id, employee_id, phone_normalized, account_status, activated_by, activated_at, revoked_at, version` | Quyết định đăng nhập theo trạng thái Admin. |
| `GIAI_DOAN_NHAN_SU` | `period_id, employee_id, stage, effective_from, effective_to, rate_policy_id, version` | Không xóa lịch sử thử việc. |
| `PHAN_CONG_CA` | `assignment_id, employee_id, branch_id, shift_code, start_at, end_at, status, schedule_version` | Lịch nhiều ca/ngày và đổi ca chính xác. |
| `SU_KIEN_DIEM_DANH` | `event_id, assignment_id, employee_id, type, server_received_at, gps_status, drive_object_id, request_id` | Ledger check-in/out bất biến. |
| `DIEU_CHINH_CONG` | `adjustment_id, assignment_id, reason, minutes_approved, approver_id, status, version` | Bổ sung/điều chỉnh có duyệt. |
| `KY_LUONG`, `CHI_TIET_LUONG`, `PHIEU_LUONG` | `run_id/item_id, employee_id, period, rate_snapshot, hours_snapshot, amount, approval_state, published_at, paid_at` | Chốt lương/phiếu lương riêng tư. |
| `NOTIFICATION_OUTBOX` | `notification_id, event_id, recipient_id, dedupe_key, type, severity, target_path, channel, delivery_status, created_at, attempts, last_error` | Bản tin gửi có thể phục hồi/đối soát; tránh gửi lặp. |
| `NOTIFICATION_INBOX` | `inbox_id, notification_id, recipient_id, read_at, acknowledged_at, dismissed_at, version` | Trạng thái xem/đã xử lý **theo từng người nhận**; không nhầm delivered với read. |
| `THAO_TAC` | `operation_id, idempotency_key, entity_id, expected_version, operation_state, outcome, error` | Đối soát ghi một phần. |
| `CAU_HINH_CHINH_SACH` | `policy_id, name, value, effective_from, effective_to, approved_by, version` | Chính sách có thời điểm hiệu lực. |

`NHAN_VIEN_TRAINING` và `NHAN_VIEN_CHINH_THUC` là bảng hiển thị/báo cáo được xuất từ master/giai đoạn, **không** là hai hồ sơ nhân viên độc lập. Giữ dữ liệu gốc cho tới khi migration được đối soát xong.

### 3.3. Quy trình ghi một tác vụ

```text
API yêu cầu (user + role + scope + idempotency_key + expected_version)
  -> validation / kiểm quyền
  -> đọc master hiện tại -> kiểm tra version/trạng thái
  -> đưa vào single-writer queue
  -> ghi các row cần thiết theo thứ tự, mã operation_id
  -> kiểm tra phản hồi + đọc xác nhận hàng cần thiết
  -> nếu hoàn chỉnh: ghi audit/outbox, trả receipt + phát Socket
  -> nếu ghi một phần: operation_state=NEEDS_RECONCILIATION, không công bố dữ liệu mới
  -> tác vụ đối soát/compensation với log và người phụ trách
```

**Không bảo đảm atomicity đa tab:** Google Sheets API cho phép batch requests nhưng không biến toàn bộ quy trình nhiều API/Drive/bot thành transaction. Không tự động rollback bằng cách xóa các hàng người khác có thể đã đọc; dùng trạng thái thao tác và đối soát. Phải thử lỗi giữa từng bước. `SYNC_QUEUE` chỉ là nhật ký/hàng đợi trên Sheet, không tồn tại nếu Google hoàn toàn không truy cập được; không hứa “zero loss” với thao tác chưa gửi tới server thành công.

## 4. Quyền truy cập — luôn kiểm tra ở backend

| Permission / Tác vụ | Admin | HR | Store | Finance | MKT | Employee |
|---|---|---|---|---|---|---|
| Quản lý role / kích hoạt / khóa tài khoản | ✓ | Đề xuất | — | — | — | — |
| Tiếp nhận nhân viên / chuyển chính thức | Xem | ✓ theo scope | Đề xuất | — | — | — |
| Tạo/duyệt/phát lịch | Cấu hình | Duyệt theo ủy quyền | Đề xuất/xác nhận chi nhánh | Xem công liên quan | — | Xem lịch mình |
| Duyệt nghỉ/đổi ca | Cấu hình | Theo ủy quyền | Theo chi nhánh được giao | — | — | Gửi phiếu |
| Xem ảnh/GPS | Theo nhiệm vụ được cấp | Ngoại lệ theo scope | Ca thuộc chi nhánh | Thường chỉ metadata công | — | Chỉ dữ liệu mình được phép |
| Lập bảng lương | — | Cung cấp công đã khóa | Xác nhận công | ✓ | — | — |
| Duyệt lương | Không mặc định | Không mặc định | Không mặc định | Không duyệt bảng mình tạo | — | — |
| Phát thông báo nội bộ | Cấu hình/duyệt | Theo ủy quyền | Tin chi nhánh nếu cấp | Tin lương riêng đúng scope | Soạn/phát theo duyệt | Nhận |

`PAYROLL_APPROVER` là permission riêng phải có văn bản ủy quyền. `READ_ONLY` là tập quyền xem, không có quyền ghi. Không trộn “role” với “nhóm nhân viên” (cửa hàng/xưởng/văn phòng/sale).

## 5. Đăng nhập nhân viên — **quyết định mới nhất**

### 5.1. Luồng bắt buộc

1. HR tạo hồ sơ nhân viên và `TAI_KHOAN_NHAN_VIEN.account_status=PENDING_ACTIVATION`.
2. Admin truy cập Web quản trị, tìm theo mã NV/SĐT, kiểm tra hồ sơ và bấm **Kích hoạt**.
3. Backend ghi `ACTIVE`, `activated_by`, `activated_at`, `version+1` vào **Google Sheets**; chỉ sau khi Sheets phản hồi/được xác nhận mới báo kích hoạt thành công.
4. Nhân viên nhập SĐT ở Web nhân viên; backend chuẩn hóa và tra `TAI_KHOAN_NHAN_VIEN` liên kết `NHAN_VIEN_MASTER` trên Sheets. Không tìm thấy/chưa ACTIVE/SUSPENDED/REVOKED/trùng không giải quyết được/Google lỗi ⇒ từ chối và thông báo phù hợp.
5. Nếu ACTIVE và hồ sơ hợp lệ, cấp phiên server và trả giao diện `PROBATION` hoặc `OFFICIAL` theo giai đoạn hiện hành. Mọi API sau đó vẫn kiểm tra trạng thái/phiên (có cơ chế thu hồi).
6. Khi Admin khóa/thu hồi: backend cập nhật Sheets trước, vô hiệu phiên và gửi socket `employee:forceLogout`. Client offline vẫn phải bị chặn ở lần gọi API sau.

```ts
// PSEUDOCODE, không phải mã chạy thật
const normalizedPhone = normalizePhone(input.phone);
const account = await sheets.accountRepository.findUniqueByPhone(normalizedPhone);
if (!account) return deny('ACCOUNT_NOT_FOUND');
if (account.ambiguous) return deny('DUPLICATE_PHONE_NEEDS_HR');
if (account.status !== 'ACTIVE') return deny(`ACCOUNT_${account.status}`);
const employee = await sheets.employeeRepository.byId(account.employee_id);
if (!employee || !isEmploymentEligible(employee)) return deny('EMPLOYMENT_NOT_ELIGIBLE');
return createRevocableSession({ employeeId: employee.id, accountVersion: account.version });
```

**RỦI RO P0 CẦN PHÊ DUYỆT:** SĐT-only là kiểm tra định danh, không xác thực người sở hữu số; người biết SĐT có thể truy cập tài khoản khác. Không tự thêm OTP ngược quyết định người dùng. Đề xuất bật xác minh bổ sung riêng cho dữ liệu lương/GPS, hoặc yêu cầu chủ dự án chọn một cơ chế xác minh trước go-live. Nếu chưa chốt, không triển khai chức năng hiển thị dữ liệu nhạy cảm dưới SĐT-only như thể đã an toàn.

### 5.2. Tài khoản quản trị

Tách với nhân viên: đăng nhập bằng phương thức xác thực riêng có độ tin cậy phù hợp, RBAC server và branchScope. Không dùng mật khẩu Admin mặc định từ file gốc, không lưu PIN thô trong `TAI_KHOAN`; không hardcode tài khoản root. Quản lý phiên, khóa tạm, logs truy cập và luồng cấp lại quyền.

## 6. Màn hình phải xây

### 6.1. Web Quản trị (01 ứng dụng)

| Route / tab | Vai trò mặc định | Dữ liệu chính / chức năng |
|---|---|---|
| `/dashboard` | Admin, HR, Store, Finance | Bộ lọc scope/kỳ, headcount, phủ ca, ngoại lệ, trạng thái cập nhật. |
| `/accounts` | Admin | Tạo role/scope, kích hoạt/khóa NV, xem activation audit. |
| `/applicants`, `/interviews` | HR | Google Form ingest, checklist, lịch PV 30 phút, kết quả HR. |
| `/employees`, `/training`, `/tests` | HR, Store theo scope | Giai đoạn, lịch 12 ngày nếu áp dụng, TEST, chuyển chính thức. |
| `/branches`, `/shift-templates` | Admin/ủy quyền | Chi nhánh/định biên/ca và effective date. |
| `/schedules`, `/leave-requests`, `/swap-requests` | HR/Store | Bản nháp/duyệt/phát lịch, xung đột và phiên bản. |
| `/attendance`, `/attendance-exceptions` | HR/Store; Finance báo cáo | Ledger check in/out, GPS/ảnh giới hạn, xác nhận công. |
| `/payroll`, `/payslip-releases` | Finance/Approver | DRAFT → RECONCILE → APPROVE → PUBLISH → PAID. |
| `/announcements` | MKT/duyệt | Tin nội bộ, nhóm nhận, hàng đợi gửi. |
| `/integrations`, `/audit`, `/backup`, `/maintenance` | Admin/IT theo quyền | Sheet API, Drive, outbox, lỗi, backup, bảo trì. |

### 6.2. Web Nhân viên (01 ứng dụng, 02 giao diện theo giai đoạn)

| Menu | Thử việc | Chính thức |
|---|---|---|
| Trang chủ / Lịch / Điểm danh / Công của tôi | ✓ | ✓ |
| Lịch đào tạo 12 ngày, nguyện vọng 5 OFF (nếu cấu hình áp dụng) | ✓ | — |
| OFF hằng tuần theo chính sách vị trí | — | ✓ |
| Đổi ca / nghỉ khẩn / yêu cầu bổ sung công | ✓ theo điều kiện | ✓ |
| Thi TEST và thông báo | ✓ | ✓ nếu HR gán |
| Phiếu lương cá nhân đã phát | ✓ khi quyền riêng tư được xử lý | ✓ khi quyền riêng tư được xử lý |

### 6.3. DESIGN SYSTEM CHUNG — yêu cầu triển khai, không phải mockup sản phẩm đã chạy

**Tư duy thiết kế:** Modern SaaS Dashboard, tối giản, gần gũi nhận diện Ụm Bò Milk; ưu tiên **tính rõ ràng, tốc độ, quyền riêng tư và khả năng thao tác** hơn animation. Một thư viện UI dùng chung cho **hai Web App**; Admin thiên về điều hành/bảng dữ liệu, Nhân viên thiên về thao tác mobile. Hình minh họa trong cuộc thảo luận chỉ là concept, **không sử dụng số nhân viên, đơn vị hoặc trạng thái minh họa làm dữ liệu thực**.

| Token/nhóm | Giá trị khởi tạo đề xuất | Quy tắc |
|---|---|---|
| `--bg` | `#FFF8F4` (kem nhạt) | Nền app, không phủ hồng toàn trang. |
| `--surface` | `#FFFFFF` | Card, table, dialog. |
| `--brand-soft` | `#F8DDE7` | Selected nav, nhấn nhẹ. |
| `--brand` | `#E85D92` | Nút chính/đường dẫn, kiểm độ tương phản trước khi dùng với chữ trắng. |
| `--text` | `#273142` | Nội dung chính. |
| `--success-soft` | `#DFF5E8` | Nền trạng thái; text dùng màu đậm đạt tương phản. |
| `--warning-soft` | `#FEF3C7` | Chờ xử lý / chú ý. |
| `--danger-soft` | `#FEE2E2` | Lỗi / cảnh báo khẩn cấp, **không dùng màu đơn độc**. |
| Radius & shadow | `8/12/16px`; đổ bóng nhẹ | Giữ nhất quán giữa card/button/dialog. |
| Spacing | thang `4/8/12/16/24/32px` | Khoảng cách theo token, không hardcode tùy tiện. |
| Typography | Font sans có hỗ trợ tiếng Việt, cỡ nội dung thường ≥14px | Cỡ mobile vùng thao tác ≥44×44 CSS px; số liệu nên dùng tabular numerals. |

- Quy chuẩn trạng thái component: `default | hover | focus-visible | active | loading | disabled | success | warning | error`; form thêm `invalid`, `helperText`, `required`, `serverError`. Hiển thị label + icon + mô tả, không chỉ dùng màu.
- Mục tiêu accessibility: tương phản tối thiểu **4.5:1 cho chữ thông thường**, 3:1 cho chữ lớn, có focus ring rõ, điều hướng bàn phím, tiêu đề/label cho screen reader, không khóa focus trong popover, không chuyển động bắt buộc. Kiểm chứng bằng công cụ và kiểm thử tay, không tự tuyên bố đạt chuẩn khi chưa đo.
- Icon Lucide cùng nét và kích thước theo token; chỉ dùng **logo/linh vật bò từ bộ nhận diện do doanh nghiệp cấp quyền**. Chưa có asset thì dùng placeholder nội bộ, không tự lấy mascot trên Internet rồi công bố là logo chính thức.
- Responsive: mobile <768px, tablet 768–1023px, desktop ≥1024px **là ngưỡng đề xuất cần thử với thiết bị thật**. Giữ một route và ngữ nghĩa xuyên kích thước, không rò dữ liệu qua HTML ẩn.
- Dark mode và tùy chỉnh màu không nằm trong MVP nếu chưa được phê duyệt; ưu tiên light theme dễ đọc, không thêm hiệu ứng ảnh hưởng hiệu năng camera/GPS.

### 6.4. WEB QUẢN TRỊ — shell và màn hình theo vai trò

**Desktop layout:** sidebar bên trái khoảng 232–256px có thể thu gọn; topbar gồm tên workspace, ô tìm kiếm theo quyền, bộ lọc chi nhánh/kỳ, trạng thái kết nối, chuông thông báo và profile. Nội dung chính gồm tiêu đề, tóm tắt, **hàng chờ hành động**, KPI card, bảng chi tiết. Mobile/tablet: sidebar thành drawer; bảng chuyển sang danh sách/card hoặc cho cuộn ngang có nhãn cột cố định. Không nhét toàn bộ bảng 20 cột vào màn hình điện thoại.

| Vai trò | Dashboard ưu tiên | Hành động nhanh/chi tiết |
|---|---|---|
| **Admin** | Tài khoản chờ kích hoạt, sức khỏe Google Sheets/Drive/Socket, ngoại lệ quyền, lỗi outbox | Kích hoạt/khóa qua dialog; quản lý role + `branchScope`, bảo trì, audit, backup. |
| **HR** | Ứng viên cần xử lý, lịch PV, thử việc gần kết thúc, thiếu ca, phiếu chờ | Lịch phỏng vấn, xét chuyển giai đoạn, lập và duyệt lịch theo permission. |
| **Store** | Ca đang chạy/sắp tới, đủ/thiếu định biên, người chưa check-in, phiếu nghỉ/đổi ca tại chi nhánh | Xử lý ngoại lệ, xác nhận công chi nhánh; không xem dữ liệu ngoài `branchScope`. |
| **Finance** | Công chờ chốt, sai lệch giờ, kỳ lương DRAFT/RECONCILE, phiếu chưa phát | Đối soát, lập kỳ, phát phiếu qua người duyệt độc lập; không hiện nội dung lương trong thông báo toàn hệ thống. |
| **MKT** | Tin nháp, tin chờ duyệt, lịch phát và lỗi gửi | Soạn/đặt lịch thông báo; chọn người nhận theo scope/nhóm; không truy cập GPS/ảnh/lương. |

- **Card KPI** hiển thị định nghĩa chỉ số, đơn vị và `updated_at`; click để lọc bảng tương ứng nếu người dùng có quyền. Nếu chưa có dữ liệu: empty state có CTA hợp lệ, **không hiện số 0 giả như dữ liệu đã đồng bộ đầy đủ**.
- **Bảng nhân viên/ứng viên:** tìm kiếm có debounce, lọc chi nhánh/trạng thái, sắp xếp, phân trang phía server; hành động theo hàng ẩn hoặc vô hiệu khi thiếu quyền và backend vẫn kiểm tra. Bảng không được tải toàn bộ ảnh GPS hoặc danh sách lương để lọc client-side.
- **Drawer chi tiết nhân viên:** tabs Hồ sơ, Giai đoạn, Lịch, Công, Lịch sử thay đổi; chỉ hiển thị phần được cấp phép. Thao tác thay đổi trạng thái phải có xác nhận + lý do khi cần + kết quả từ Sheets.
- **Tác vụ dễ sai** (khóa tài khoản, phát lịch, phê duyệt công/lương, bảo trì, restore) dùng confirmation dialog nêu rõ đối tượng, tác động và người thực hiện; **không cho nút giao diện tự quyết định nghiệp vụ**. Các tác vụ cực kỳ nhạy cảm tuân theo quy trình ủy quyền đã chốt ở mục 4/7.
- Dùng skeleton trong vùng đang tải; khi mất kết nối cho thấy banner `Đang mất kết nối / Chưa đồng bộ`, giữ dữ liệu cuối cùng nhưng gắn nhãn thời điểm và không cho hiểu là dữ liệu hiện hành.

### 6.5. WEB NHÂN VIÊN — mobile-first, cùng một app hai chế độ

1. **Màn hình SĐT:** logo doanh nghiệp, trường SĐT có chuẩn hóa, nút Tiếp tục, hỗ trợ lỗi `ACCOUNT_NOT_FOUND`, `PENDING_ACTIVATION`, `SUSPENDED`, `REVOKED`, `DUPLICATE_PHONE_NEEDS_HR`, `SHEETS_UNAVAILABLE`. Chỉ hiển thị trạng thái sau phản hồi server; không dùng spinner vô hạn.
2. **Trang chủ:** lời chào + loại nhân viên/chi nhánh, thẻ ca gần nhất (`start/end/branch`), nút **Điểm danh** nổi bật khi đủ điều kiện; cạnh đó Lịch, Đăng ký OFF, Công của tôi; thẻ cảnh báo/phiếu cần xử lý. Nếu chưa được phân ca thì hiển thị rõ **Chưa có ca được công bố**, không mở camera hoặc cấp công.
3. **Thanh điều hướng mobile:** Trang chủ / Lịch làm / Điểm danh / Lương; các tác vụ ít dùng (đổi ca, nghỉ khẩn, TEST, hồ sơ) ở menu “Khác” hoặc shortcut theo ngữ cảnh. `Lương` chỉ hiện dữ liệu khi cơ chế quyền riêng tư ở mục 5.1 đã chốt; nếu chưa, dùng trạng thái hạn chế an toàn.
4. **Thử việc:** hiển thị lịch 12 ngày và nguyện vọng 5 OFF **chỉ khi chính sách áp dụng**; số ngày WORK/OFF đã được duyệt, TEST được HR gán và kết quả; không tự mặc định đủ 7 ngày là chính thức.
5. **Chính thức:** lịch T2–CN, OFF theo chính sách vị trí, đổi ca, phiếu nghỉ khẩn, công và phiếu lương cá nhân đã phát; không hiển thị lương đồng nghiệp.
6. **Điểm danh:** trình tự hướng dẫn GPS → kiểm accuracy → camera live → xác nhận; có màn hình xin quyền truy cập dễ hiểu và phương án gửi ngoại lệ. Sau nhấn, thể hiện `Đang kiểm tra` → `Đang lưu` → `Đã ghi nhận` **chỉ khi có receipt từ backend/Sheets và Drive theo rule mục 7.4**. Ảnh preview không phải bằng chứng đã lưu.
7. **Offline/kết nối yếu:** có banner và hướng dẫn liên hệ Store/HR; không tạo dấu kiểm thành công giả và không giữ ảnh/GPS nhạy cảm lâu dài trong localStorage/IndexedDB. Cho phép khởi tạo ngoại lệ qua kênh vận hành khi không thể gửi bản ghi.

### 6.6. MICRO-INTERACTIONS / NÚT — quy tắc chính xác để AI viết CSS và state

| Component | Tương tác thị giác đề xuất | Quy tắc nghiệp vụ |
|---|---|---|
| Primary button | Hover nâng nhẹ/đổi sắc 120–160ms, active thu nhẹ 90–120ms | Khi `pending`: spinner + khóa nút/chống double-click + giữ `Idempotency-Key`; chỉ đổi thành dấu kiểm sau receipt. |
| Toggle | Chuyển màu/đổi vị trí 150–200ms, nhãn Bật/Tắt | Chỉ commit UI theo response; thất bại trả về trạng thái gốc và hiện lỗi. |
| Tabs/sidebar | Active nền hồng nhạt; underline/slide nhẹ 150–200ms | Route/permission phải xác minh ở server; không mất filter nếu quay lại. |
| Dropdown/popover | Fade/translate ngắn 150–180ms | ESC đóng, click ngoài đóng, giữ focus thích hợp. |
| Dialog | Fade + scale rất nhẹ 180–220ms | Focus trap đúng cách; hành động nguy hiểm cần confirm, không auto-submit. |
| Toast | Xuất hiện nhẹ, không gây giật | Success ~4s, warning tùy ngữ cảnh, error đủ lâu để đọc; thông báo quan trọng phải còn trong Inbox. |
| Skeleton | Khung tĩnh hoặc shimmer rất nhẹ | Bám kích thước nội dung, dừng khi resolve, có timeout/error state. |
| Nút chấm công | Nhấn → tiến trình xác minh rõ 3 trạng thái | Không tự đóng app nếu chưa xác nhận; không hứa Telegram Mini App hỗ trợ lệnh đóng trong mọi trình duyệt. |

- Tôn trọng `prefers-reduced-motion`: tắt translate/scale/shimmer gây xao nhãng, giữ phản hồi bằng text/icon. Không nhấp nháy, rung liên tục, confetti khi điểm danh, hoặc âm thanh mặc định.
- Không sử dụng animation trong danh sách hàng nghìn dòng; ảo hóa bảng **chỉ khi cần và không làm mất accessibility hoặc thao tác chọn/copy**. Dừng polling/animation khi tab nền nếu phù hợp.
- Mọi action phải có trạng thái `idle | validating | submitting | confirmed | failed | needs_reconciliation`; không dùng duy nhất `loading` để che việc Sheet đã ghi một phần.

### 6.7. NOTIFICATION CENTER / REALTIME — không được đánh đồng Socket với lưu trữ

**Nguồn sự kiện:** Admin kích hoạt, phiếu đổi ca/OFF cập nhật, HR phát lịch, công được ghi nhận/gắn cờ, phiếu lương được phát riêng, lỗi Google Sheets/Drive, thông báo nội bộ. Phân loại `SUCCESS | ACTION_REQUIRED | URGENT | SYSTEM`; chỉ `URGENT` cho thiếu nhân sự thực sự, gián đoạn dịch vụ hoặc dữ liệu cần xử lý ngay, tránh báo động giả.

**Luồng giao nhận tối thiểu:**

```text
Nghiệp vụ hợp lệ + Sheets ghi/đọc xác nhận
  → tạo notification_id/event_id/dedupe_key theo operation đã hoàn tất
  → ghi NOTIFICATION_OUTBOX + NOTIFICATION_INBOX trên Sheets theo người nhận/scope
  → backend gửi Socket vào room đã xác thực (user:{id}, role/branch đã kiểm)
  → client nhận, dedupe event_id, cập nhật badge/toast và gọi API lấy dữ liệu chuẩn
  → khi reconnect/focus: GET /me/notifications?cursor=... + GET snapshot/version liên quan
  → người dùng đánh dấu đã đọc/đã xử lý → backend ghi Sheets và phát cập nhật badge
```

- Với thao tác nhiều tab, **chỉ phát thông báo kết quả nghiệp vụ khi operation = COMPLETED**; nếu `NEEDS_RECONCILIATION`, gửi cảnh báo cho Admin/IT thay vì báo “Đã kích hoạt/đã chốt lương”. Bản tin chưa ghi được vào Sheet khi Google lỗi **không được hứa lưu bền**: log vận hành/giám sát server theo điều kiện hạ tầng, xác nhận trạng thái thất bại và hỗ trợ đối soát.
- **Socket chỉ là delivery nhanh, không phải sự thật duy nhất**. HTTP Inbox + snapshot là nguồn đọc chính khi người dùng mở lại; không coi `socket.emit()` là nhân viên đã đọc. `delivery_status` và `read_at`/`acknowledged_at` phải khác nhau.
- **Toast success** góc phải desktop/trên mobile, tự ẩn ~4s; **chờ duyệt** hiện badge chuông + hàng chờ có deep link tới phiếu; **khẩn cấp** có banner bền đến khi sự cố giải quyết hoặc được người có quyền xác nhận. Không bật notification âm thanh/browser push mặc định; browser push cần consent và hạ tầng riêng, ngoài MVP.
- Chuông mở popover ở desktop và full-screen sheet/drawer trên mobile: tabs Tất cả / Chưa đọc / Cần xử lý; hiển thị loại, tiêu đề, tóm tắt an toàn, giờ, trạng thái, CTA hợp lệ. Phân trang/cursor; một hàng thông báo có action “đánh dấu đã đọc”, nhưng **không đánh dấu đã xử lý thay người dùng chỉ vì đã mở**.
- **Bảo mật:** Không đưa nội dung lương, GPS, ảnh, SĐT đầy đủ vào payload/toast/browser push/nhóm Telegram; gửi text chung “Có phiếu lương mới” và lấy chi tiết qua API có kiểm quyền. Room socket xây từ phiên server, không tin `roomId/role/branch` do client tự khai. Thu hồi account phải rời room và chặn các GET tiếp theo.
- Dedupe theo `(recipient_id, event_id, channel)` hoặc `dedupe_key` bền; có `retry/backoff`, `attempts`, `last_error` và trạng thái `QUEUED | SENT | FAILED`; **không cam kết exactly-once delivery**, client idempotent và backend đối soát được. Mốc thời gian lưu UTC, hiển thị `Asia/Ho_Chi_Minh`.
- Với lỗi kết nối: hiển thị `Đã mất kết nối – thông tin có thể chưa cập nhật`; reconnect có backoff, đối chiếu phiên bản và unread count từ API. Polling dự phòng **có giới hạn và chỉ khi cần**, không gọi Google Sheets trực tiếp từ từng browser hoặc liên tục 1–2 giây.

**API bổ sung (đề xuất):** `GET /me/notifications?cursor=&filter=`, `POST /me/notifications/:id/read`, `POST /me/notifications/:id/acknowledge` (theo quyền), `GET /admin/notifications/health`. **Socket events:** `notification.created`, `notification.updated`, `notification.unread-count`, `integration.failed` với `event_id`, `notification_id`, `entity_id`, `version`, `created_at`; tên event đã có ở mục 8 vẫn được duy trì để tránh breaking change. Client không dùng payload sự kiện để mở khóa tác vụ.

### 6.8. UI STATES, màn hình sự cố, và tiêu chí nghiệm thu giao diện

- **Mỗi màn hình có đủ:** initial loading, empty (chưa có dữ liệu), filled, validation error, 403/không có quyền, Sheets timeout/quota, socket disconnected, retry và `NEEDS_RECONCILIATION`. Có button “Thử lại” chỉ khi retry an toàn; không retry mù mutation không có idempotency.
- SĐT-only **không phải xác thực danh tính mạnh**: không hiển thị phiếu lương/ảnh/GPS chỉ vì UI đã đăng nhập; backend áp dụng P0 ở mục 5.1, UX thể hiện trạng thái bị hạn chế khi chưa có giải pháp.
- Giao diện thời gian thực phải phân biệt rõ `Đã gửi yêu cầu`, `Đang lưu`, `Đã lưu thành công`, `Cần đối soát`, `Không thể thực hiện`; không tự biến nút màu xanh khi chỉ nhận một sự kiện Socket.
- Bộ màn hình bàn giao tối thiểu: (A) Admin Dashboard desktop + mobile, (B) HR/Store/Finance/MKT Dashboard với dữ liệu mẫu đã gắn `DEMO`, (C) nhân viên thử việc/chính thức mobile, (D) đăng nhập/chưa kích hoạt, (E) GPS/camera/lỗi quyền, (F) Notification Center/toast/banner, (G) dialog xác nhận/empty/error/skeleton.
- Test responsive ở ít nhất 360px, 390px, 768px, 1024px, 1440px; máy có notch/safe-area, trình duyệt mobile phổ biến và bàn phím ảo; không để CTA bị bottom navigation che.

### 6.9. UI ACCEPTANCE TESTS — bổ sung vào checklist mục 9

| Mã | Tình huống | Kỳ vọng |
|---|---|---|
| UI-01 | Admin desktop → Store chỉ được CN130 | Dashboard/card/filter/route đúng scope; gọi API CN khác vẫn 403. |
| UI-02 | Màn hình NV 360px, bàn phím mở | Không tràn ngang; SĐT/CTA không bị che; vùng chạm đủ lớn. |
| UI-03 | Nhấn kích hoạt hai lần thật nhanh | Một operation; pending không báo success sớm; retry dùng idempotency. |
| UI-04 | Sheets lỗi giữa nhiều bước | `NEEDS_RECONCILIATION`; không có toast thành công hoặc lịch/lương công bố nửa vời. |
| UI-05 | NV offline lúc Admin phát lịch, sau đó reconnect | API snapshot/Inbox trả lịch và thông báo chưa đọc đúng; không phụ thuộc sự kiện Socket cũ. |
| UI-06 | Người khác thử gửi roomId/branchId qua Socket | Không subscribe được, không nhận payload ngoài scope. |
| UI-07 | Notification về phiếu lương | Toast/payload không có số tiền/ảnh/GPS; API chi tiết bảo vệ quyền. |
| UI-08 | Đánh dấu đã đọc nhưng chưa xử lý | Unread giảm, queue action-required còn nguyên; `acknowledged_at` chưa đặt. |
| UI-09 | `prefers-reduced-motion`, keyboard, screen reader | Không motion bắt buộc; focus rõ; tab/dialog có tên và ESC hợp lệ. |
| UI-10 | Camera/GPS bị từ chối và thao tác điểm danh timeout | Có ngoại lệ/hướng dẫn; không ghi công giả, không mất form không cần thiết. |
| UI-11 | MKT draft thông báo, không có quyền duyệt | Không thấy hành động trái quyền; endpoint từ chối request giả. |
| UI-12 | Mock KPI thiếu nguồn hoặc dữ liệu demo | UI gắn DEMO hoặc trạng thái chưa đồng bộ, không hiển thị số liệu giả là production. |

**Definition of Done cho giao diện:** component tokens tái sử dụng; không hardcode số liệu demo vào production; bảng và form chạy đúng với API/mock có schema; UI states + realtime/reconnect test đạt; kiểm thử accessibility và chụp ảnh 2 kích thước; đo Web Vitals trên thiết bị mục tiêu và xử lý lỗi nghiêm trọng trước pilot. Chỉ công nhận demo thông báo “realtime” khi backend thực ghi Sheets/Inbox + socket + reconnect đã được kiểm chứng.

## 7. Bảy workflow nghiệp vụ

### 7.1. Tuyển dụng

- Google Form `FROM_NHAN_VIEN` → nạp idempotent theo response/submission id → hồ sơ `NEW` hoặc `NEED_INFO` → HR review → mời PV → xác nhận → người phỏng vấn chấm → HR quyết định.
- Không tự loại theo năm sinh/quê quán/Facebook/nguồn người quen; thang trong TXT cộng được 13 điểm nhưng ghi 14, **không đưa vào production**.
- Slot phỏng vấn theo `interviewer_id` + start/end; cấu hình mẫu T2–T7, 08:00–17:00, mỗi slot 30 phút. Calendar/Meet/email/Zalo OA chỉ bật khi cấp quyền và test API thành công.

### 7.2. Thử việc / đào tạo

- `PRE_ONBOARDING` → `PROBATION` sau HR xác nhận. Mẫu 12 ngày lịch (7 làm/5 OFF) chỉ áp dụng vị trí/chính sách đã được phê duyệt; ngày kết thúc = ngày đầu + 11 ngày.
- Nhân viên chọn OFF → server lưu draft → Store/HR kiểm tra min_staff → phê duyệt → công bố lịch. Không tự duyệt OFF/đổi ca sau 15 phút.
- TEST mẫu 25 câu * 0,4 = 10; 480s đo server; ngân hàng câu hỏi phải có quyền thật; ngưỡng <5 / 5–<8 / >=8 chỉ được kích hoạt nếu HR ký duyệt.
- HR quyết định chính thức theo đánh giá + công + thỏa thuận; không xóa lịch sử thử việc. Rate có `effective_from`.

### 7.3. Lịch, OFF, đổi ca, nghỉ khẩn

- Ca mẫu: 07–12, 12–18, 18–23 giờ Asia/Ho_Chi_Minh; mọi assignment có start/end ISO và ngày thật. Khung OFF đề xuất T6 12:00 → T7 15:00 cho tuần sau, tối đa 2 ngày **nếu chính sách vị trí cho phép**.
- Scheduler phải dùng min_staff/max_staff, kỹ năng, chồng giờ, thời gian nghỉ, OFF và branchScope; không cấm cứng 2 người cùng ca cùng nghỉ hoặc cùng làm.
- Đổi ca: A yêu cầu → B đồng ý → Store/HR duyệt → cập nhật toàn bộ assignment liên quan thông qua operation log + đối soát Sheet → publish version mới. Nếu một bước fail thì trạng thái `NEEDS_RECONCILIATION`, chưa phát lịch một nửa.
- Nghỉ khẩn: ghi nhận nghỉ và bài toán tìm người thay **tách biệt**; không có người thay báo `ESCALATED_UNCOVERED`, không tự đánh dấu nhân viên chắc chắn đi làm.

### 7.4. Điểm danh và bằng chứng

- Nhân viên ACTIVE + assignment PUBLISHED → check-in mở tối đa 30 phút trước ca mẫu. GPS <=300m **và** accuracy đạt ngưỡng cấu hình; camera `getUserMedia`, không upload thư viện trong luồng thường. Không có quyền camera/GPS → ngoại lệ có quản lý xác minh.
- Ảnh Drive path ID bất biến: `attendance/YYYY/MM/DD/{branch_id}/{employee_id}/{shift_id}/{event_id}_IN.jpg` / `_OUT.jpg`. Không đặt SĐT/họ tên vào tên thư mục, không tạo link public.
- Lưu `SU_KIEN_DIEM_DANH` theo `event_id + request_id`; receipt được trả khi dữ liệu cần thiết xác nhận. Event gốc bất biến, sai công điều chỉnh qua `DIEU_CHINH_CONG`.
- Check-out trước giờ kết thúc được ghi giờ thật và `FLAG_EARLY`; không khóa nút. Mất một lượt không tự mất toàn bộ lương ca. Đi trễ chỉ là cờ và số phút thực, **không khấu trừ “phạt” tự động**.

### 7.5. Công và lương

- Store kiểm tra/duyệt công chi nhánh → HR khóa bản chụp kỳ công → Finance lập kỳ lương DRAFT, tính theo đơn giá/giờ có ngày hiệu lực, giờ được duyệt, phụ cấp/OT/lễ hợp lệ → đối soát → người được ủy quyền duyệt độc lập → phát phiếu riêng → PAID khi có chứng từ.
- Mức từ nguồn: thử việc 21.000đ/h (**CHỜ rà chính sách**), chính thức 25.500đ/h (mức tham chiếu, kiểm tra theo vị trí); ca 5h = 127.500đ chính thức, ca 6h = 153.000đ nếu toàn bộ giờ tính lương. Không dùng tự động x2 mọi lễ/x3 một vài ngày Tết trước khi chốt chính sách có hiệu lực.
- “Trừ KPI/vi phạm” không đồng nghĩa khấu trừ tiền phạt. Phiếu đã PUBLISHED có sai sót → adjustment / revision mới, không sửa đè.

### 7.6. Truyền thông / bot

- Tin MKT tạo DRAFT → duyệt nếu có quy định → gửi đúng nhóm/scope qua outbox, lưu status và last_error. Bot Telegram (NV/HR/Finance) gọi chung API/RBAC; không có khả năng tự động gửi/đọc Zalo cá nhân mặc định.
- Không gửi SĐT hàng loạt, ảnh/GPS hoặc lương chi tiết vào nhóm Telegram/Zalo. Không tuyên bố tin đã đọc khi nhà cung cấp chỉ trả trạng thái đã gửi.

### 7.7. Admin, bảo trì và sao lưu

- Admin quản quyền/chi nhánh, kích hoạt/khóa, cấu hình, audit, đồng bộ và backup. Không có `/reset_hethong` trên bot sản xuất; phục hồi cần bản snapshot, kiểm thử và phê duyệt nhiều người.
- Backup gồm bản sao Sheets và Drive riêng; đo RPO/RTO theo nhu cầu được chốt, phục hồi thử trên môi trường non-prod và kiểm link ảnh, lương, quyền sau khôi phục.

## 8. Hợp đồng API tối thiểu (đề xuất)

```http
POST /auth/employee/phone-login
POST /auth/admin/login
POST /admin/employee-accounts/:id/activate
POST /admin/employee-accounts/:id/revoke
GET  /me
GET  /me/schedule?week=YYYY-MM-DD
POST /applications/import
POST /interviews
POST /leave-requests
POST /swap-requests
POST /swap-requests/:id/respond
POST /swap-requests/:id/approve
POST /schedules/:week/publish
POST /attendance/events
POST /attendance/adjustments
POST /attendance/adjustments/:id/approve
POST /payroll/:period/calculate
POST /payroll/:run/approve
POST /payroll/:run/publish
POST /payroll/:run/mark-paid
GET  /me/payslips
GET  /admin/integrations/status
GET  /admin/audit
GET  /me/notifications?cursor=&filter=
POST /me/notifications/:id/read
POST /me/notifications/:id/acknowledge
GET  /admin/notifications/health
```

- Mỗi mutation: `Idempotency-Key` + `expected_version` nếu cập nhật thực thể tồn tại + actor/scope server-side + `operation_id` trong phản hồi. Dùng mã lỗi ổn định: `NOT_FOUND`, `PENDING_ACTIVATION`, `SUSPENDED`, `REVOKED`, `SHEETS_UNAVAILABLE`, `VERSION_CONFLICT`, `NEEDS_RECONCILIATION`, `FORBIDDEN`, `DUPLICATE_PHONE_NEEDS_HR`.
- Không trả GPS/Drive object IDs hay thông tin lương của đồng nghiệp từ API `/me`; signed URL ảnh nếu thật sự cần phải hạn ngắn và kiểm scope.
- Socket events: `account.activated`, `employee:forceLogout`, `schedule.published`, `leave.updated`, `swap.updated`, `attendance.recorded`, `attendance.flagged`, `payroll.published`, `integration.failed`, `notification.created`, `notification.updated`, `notification.unread-count`; payload có `event_id/entity_id/version` tối thiểu và không chứa dữ liệu nhạy cảm.

## 9. UAT và test tự động — bắt buộc trước go-live

| Test | Dữ liệu đầu vào | Kỳ vọng |
|---|---|---|
| AUTH-01 | SĐT chưa tồn tại | Từ chối, không tiết lộ dữ liệu khác. |
| AUTH-02 | SĐT có hồ sơ, `PENDING_ACTIVATION` | Từ chối và thông báo chưa kích hoạt. |
| AUTH-03 | Admin kích hoạt, API Sheets lỗi | Không báo thành công, tài khoản không được cấp quyền. |
| AUTH-04 | `ACTIVE`, đúng giai đoạn | Đúng dashboard; `REVOCATION` chặn mọi lần gọi tiếp. |
| AUTH-05 | Hai account cùng SĐT | Không chọn ngẫu nhiên, đưa về HR xử lý. |
| RBAC-01 | Store CN130 gọi dữ liệu CN261 | 403; không trả dữ liệu. |
| RBAC-02 | Marketing gọi payslip/GPS | 403. |
| SCHED-01 | Hai OFF cùng ca, min_staff vẫn đủ | Cho phép nếu chính sách khác hợp lệ. |
| SCHED-02 | Swap cập nhật nhiều assignment và fail giữa chừng | Không publish lịch nửa vời; có operation cần đối soát. |
| ATT-01 | Retry check-in cùng request_id | Một event/receipt, không hai công. |
| ATT-02 | Camera/GPS lỗi | Ngoại lệ có thể xử lý, không kết luận gian lận. |
| ATT-03 | Check-out sớm/quên lượt | Ghi giờ thật/cờ; cho request bổ sung công. |
| PAY-01 | Rate đổi giữa kỳ | Kết quả theo effective date/snapshot. |
| PAY-02 | Người lập kỳ tự duyệt | Chặn nếu không có quyền/tách nhiệm vụ. |
| PAY-03 | NV A truy cập payslip NV B | 403/404, không rò dữ liệu. |
| DATA-01 | Sheets hết hạn mức / timeout | Backoff/reconcile, không success giả. |
| DATA-02 | Backup restore trên test | ID/version/audit, ảnh Drive, phiếu lương đối soát đúng. |

**Load test bắt buộc:** giả lập giờ vào/ra ca với số lượng nhân viên đỉnh do CEO/IT cung cấp; đo thời gian từ click tới receipt xác nhận Sheets và Drive, lỗi API/hạn mức, tốc độ queue và khả năng phục hồi. Chưa có số nhân viên/tần suất đủ để cam kết hệ thống “realtime” theo SLA cụ thể.

## 10. Roadmap / Definition of Done

| Phase | Deliverable | Điều kiện nghiệm thu |
|---|---|---|
| P0 — Discovery & UI foundation | Chốt Q01–Q14; đọc schema và backup, phân quyền Google, duyệt visual direction/design tokens | Có bản kê schema/quyền, tokens, wireframe theo vai trò và danh sách quyết định treo. |
| P1 — Foundation | Sheets repository, single writer, audit, roles, account activation, SĐT login; UI shell, button/forms, responsive, base Inbox | AUTH/RBAC/DATA và UI nền tảng đạt; không lộ secrets. |
| P2 — Core HR | Form ingest, phỏng vấn, hồ sơ/giai đoạn, lịch/OFF/swap; dashboard Admin/HR/Store + bảng và action queue | Lịch chỉ PUBLISHED sau duyệt, có version; role dashboards/scope đúng. |
| P3 — Attendance | GPS/camera, Drive, event ledger, ngoại lệ và chốt công; mobile UI nhân viên hai giai đoạn | Retry không trùng, lỗi không xóa công; mobile/GPS/camera UI tests đạt. |
| P4 — Payroll | Engine có hiệu lực, tách người lập/duyệt, payslip cá nhân; Finance/MKT dashboards và giao diện riêng tư | PAY tests đạt, chính sách có chữ ký phê duyệt, không lộ dữ liệu trong notifications. |
| P5 — Integration/UAT | Notification Center/Socket/reconnect/outbox, Bot/tin nội bộ theo API được cấp, load, backup/restore, pilot | UAT nghiệp vụ + UI-01–UI-12 + reconnect + rollback + đào tạo người dùng. |

**Không được phép gọi “hoàn thành”** nếu thiếu khóa Google API hợp lệ, thiếu quyền Drive, chưa đọc schema ngân hàng TEST hoặc các chính sách lương còn chờ duyệt; ghi rõ `BLOCKED` và hướng dẫn yêu cầu chủ dự án cung cấp thông tin.

## 11. Quyết định còn treo cần hỏi chủ dự án (chỉ hỏi một lần theo nhóm)

- Q01: Biện pháp ngăn truy cập lương/ảnh/GPS bằng SĐT của người khác khi đăng nhập SĐT-only; ai phê duyệt rủi ro?
- Q02: Nhóm nhân viên nào áp dụng thử việc 12 ngày/7 làm/5 OFF, hình thức hợp đồng nào?
- Q03: Đơn giá thử việc theo công việc; mức chính thức 25.500đ/h áp dụng ai và khi nào?
- Q04: Định biên từng chi nhánh–ca, giờ nghỉ và quy chế 2 OFF/tuần?
- Q05: Ai được ủy quyền duyệt lương, ngày trả cụ thể, chính sách khiếu nại?
- Q06: Cấu hình OT/ngày lễ/ngày Tết, tiền thưởng và các khoản khấu trừ được phép?
- Q07: Chính sách sử dụng/lưu trữ/xóa ảnh, GPS và quyền truy cập?
- Q08: Số lượng nhân viên đồng thời, nhu cầu SLA và quyền sửa trực tiếp Sheets?
- Q09: ID/quyền ngân hàng câu hỏi và schema thực tế bảng lương?
- Q10: Quy trình migration sang tab mới và quyền Google service account?
- Q11: Bộ logo/mascot, font và màu thương hiệu chính thức có được cấp để đưa vào sản phẩm chưa? Ai duyệt UI?
- Q12: Cần bật browser push/sound hay chỉ in-app notification trong MVP; mức khẩn cấp do vai trò nào xác nhận?
- Q13: Chốt thời gian lưu notification/inbox, cách xử lý archive/ack và phạm vi người nhận theo chi nhánh.
- Q14: Thiết bị/trình duyệt nhân viên đang dùng, khả năng xử lý camera/GPS thực tế và ngưỡng hiệu năng cần đạt?

## 12. Hồ sơ nguồn để đối chiếu

1. `Hệ Thống Nhân Sự(1).docx` (yêu cầu dự án lịch sử).
2. `KHỐI NGHIỆP VỤ & CHỨC NĂNG.txt` (07 khối nghiệp vụ bổ sung).
3. `UmBoMilk_HR_Dac_ta_Nghiep_vu_Hoan_chinh_V3.docx` và `UmBoMilk_HR_Nghiep_vu_Chuc_nang_Dieu_chinh_V4.docx` (bản rà soát trước; kiến trúc PostgreSQL master đã được thay thế).
4. Quyết định trong hội thoại ngày 23/09/2026: 2 Web App, 5 vai trò nội bộ, đăng nhập SĐT kiểm tra Sheets + Admin kích hoạt, Google Sheets làm nguồn dữ liệu chính.
5. Bổ sung từ đề xuất giao diện trong hội thoại 23/09/2026: Modern SaaS hồng–kem, dashboard theo 5 vai trò, mobile-first nhân viên, button micro-interactions, notification center và Socket reconnect. Đây là **đề xuất UI**, không phải chức năng đã phát triển hoặc bộ nhận diện đã được duyệt.
6. Tài liệu giới hạn Sheets API: https://developers.google.com/workspace/sheets/api/limits ; Telegram Mini App: https://core.telegram.org/bots/webapps . Nguồn pháp lý được liệt kê ở V4 chỉ dùng làm cảnh báo rà soát, không phải phê duyệt chính sách của doanh nghiệp.
