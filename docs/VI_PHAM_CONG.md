# Tòa Án Tối Cao Ụm Bò Milk — Hệ thống kiểm soát & xử lý vi phạm

Web app riêng, phục vụ tại `https://<domain>/violations/`, dùng chung backend và kho dữ liệu
(Google Sheets / PostgreSQL) của hệ thống nhân sự.

## 1. Đăng nhập & phân quyền

Hệ thống có **2 tài khoản**, mỗi tài khoản gắn với một mã PIN 8 số. Nhập PIN nào thì vào đúng tài khoản đó.

| Tài khoản | PIN mặc định | Quyền hạn |
| --- | --- | --- |
| **Admin** | `12345678` | Toàn quyền: xem tổng quan, quản lý quy chế, lập phiếu, **sửa mức phạt**, **duyệt phiếu**, xóa phiếu, đồng bộ Drive/KPI. |
| **Nhân viên lập phiếu** | `68686868` | Chỉ màn **Bắt lỗi vi phạm** và **Tài khoản**: lập phiếu với mức phạt đúng theo quy chế, gửi chờ Admin duyệt. **Không** duyệt phiếu, **không** sửa mức phạt, không xóa phiếu, không quản lý quy chế. |

- Nhân viên dùng ngay PIN `68686868`, không bị buộc đổi; có thể tự đổi PIN trong **Tài khoản & Bảo mật**.
- PIN của 2 tài khoản phải khác nhau; hệ thống chặn đổi/cấp lại nếu trùng.
- Quyền được chặn ở cả backend: API duyệt phiếu, sửa tiền, xóa phiếu, quản lý quy chế, đồng bộ Drive
  trả `403 FORBIDDEN` với tài khoản nhân viên; mức phạt nhân viên gửi lên luôn bị ghi đè bằng mức trong quy chế.
- Lần đăng nhập đầu tiên của Admin (hoặc sau khi cấp lại PIN) bắt buộc đổi PIN trước khi dùng chức năng.
- Cấp lại mật khẩu: đưa PIN của **chính tài khoản đang đăng nhập** về mã mặc định (`12345678` cho Admin,
  `68686868` cho nhân viên), tăng `pin_version` (thu hồi mọi phiên cũ) và buộc đổi PIN ở lần sau.
- Token riêng `typ=violation-access`, hạn 12 giờ; không dùng token nhân viên/admin.

## 2. Chức năng

| Chức năng | Mô tả | Quyền |
| --- | --- | --- |
| Tổng quan | Bảng điều khiển 4 chỉ số (chờ duyệt, đã duyệt, KPI tháng, quy chế hiệu lực) và danh sách phiếu gần đây. | Admin |
| Quy chế Công Ty | Tra cứu, thêm, sửa, xóa lỗi vi phạm và mức phạt — đồng bộ realtime sang màn hình bắt lỗi. | Admin |
| Bắt Lỗi Vi Phạm | Chọn nhân viên (tên + chi nhánh), thêm nhiều lỗi, tự cộng tổng. Admin được sửa mức phạt; nhân viên dùng mức phạt cố định theo quy chế. | Cả hai |
| Phiếu Chờ Duyệt | Phiếu `Lưu tạm`; xem chi tiết, **nhập lại mức phạt từng lỗi** (VD giảm cho lần vi phạm đầu), lưu thay đổi, duyệt hoặc xóa. | Admin |
| Phiếu Đã Duyệt | Kho phiếu đã duyệt, trạng thái PDF Drive + TRỪ KPI. Mức phạt đã khóa sau khi duyệt. | Admin |
| Tài Khoản & Bảo Mật | Thông tin phiên làm việc, thẩm quyền theo vai trò, đổi PIN 8 số và cấp lại mật khẩu khẩn cấp. | Cả hai |

Giao diện dùng nền sáng, thanh điều hướng cố định bên trái (thu gọn thành thanh dưới trên di động).
Các thao tác quản trị quy chế được gộp chung vào màn hình **Quy chế Công Ty**; hồ sơ và đổi PIN được gộp
chung vào **Tài Khoản & Bảo Mật** để tránh trùng lặp màn hình. Có thể mở thẳng màn hình bằng hash:
`#dashboard`, `#regulations`, `#catch`, `#pending`, `#approved`, `#account` (tài khoản nhân viên chỉ
mở được `#catch` và `#account`; hash khác tự chuyển về `#catch`).

### 2.1. Bộ mã lỗi mặc định

Bộ quy chế gốc bám theo bảng **“QUY CHẾ LÀM VIỆC DÀNH CHO NHÂN VIÊN TẠI CỬA HÀNG”**
(32 mã lỗi, 2 nhóm `TÁC PHONG` và `VẬN HÀNH`). Mỗi mã có nội dung và mức phạt riêng; khi chọn mã
ở màn hình **Bắt Lỗi Vi Phạm**, mức phạt được điền tự động. Chỉ **Admin** được sửa lại số tiền mong muốn
ngay trong danh sách lỗi của phiếu trước khi lưu; tài khoản nhân viên hiển thị mức phạt cố định theo
quy chế. Nút khôi phục giúp trả về đúng mức phạt gốc của quy chế.

Với phiếu đang chờ duyệt, mở **Chi tiết** để nhập lại số tiền từng lỗi và bấm **Lưu thay đổi** trước khi
duyệt — phù hợp khi cần giảm mức phạt (ví dụ nhân viên vi phạm lần đầu). Hệ thống lưu vết tổng phạt gốc,
người điều chỉnh và thời điểm điều chỉnh; phiếu đã duyệt bị khóa vì PDF Drive và TRỪ KPI đã đồng bộ.

- Mức phạt cố định (VD `VAO TRE 5P` → 30.000đ) điền thẳng vào ô tiền.
- Mức phạt không quy ra số tiền cố định (VD `10% lương/ tháng`, `Công ty quyết định`,
  `Tự chịu trách nhiệm`, `Buộc thôi việc`) lưu ở trường `fine_note`; ô tiền để trống cho người
  lập phiếu nhập số cụ thể.
- Phiên bản bộ luật lưu ở `violationCatalogVersion`; khi nâng phiên bản, hệ thống tự thay các mã
  mặc định cũ nhưng giữ nguyên quy chế do người dùng tự thêm.

## 3. Lưu trữ dữ liệu

Các khóa trong system settings (tab `CAU_HINH_HE_THONG` của kho dữ liệu):

- `violationRegulations` — danh sách quy chế + mức phạt (kèm `fine_note` nếu có).
- `violationTickets` — toàn bộ phiếu vi phạm (chưa duyệt + đã duyệt).
- `violationPortalAccounts` — danh sách 2 tài khoản (ADMIN, CREATOR) kèm hash PIN, `pin_version`, `must_change_pin`.
- `violationPortalAccount` — bản tương thích cũ, luôn trỏ tới tài khoản ADMIN.
- `violationCatalogVersion` — phiên bản bộ quy chế mặc định đang áp dụng.
- `violationSettingsUpdatedAt` — mốc cập nhật gần nhất của cổng vi phạm.

Dữ liệu đi theo luồng `updateSystemSettings` sẵn có nên tự đồng bộ Google Sheets (hoặc PostgreSQL
khi `DATA_STORE=postgres`). Không cần thêm bảng riêng.

> **Chống mất dữ liệu:** mỗi thao tác quan trọng (đổi PIN, lưu/duyệt/xóa phiếu, sửa quy chế) đẩy
> ngay `CAU_HINH_HE_THONG` lên Sheet và ghi mốc `violationSettingsUpdatedAt`. Khi một lượt pull
> Sheet chạy xen giữa, bản ghi trong bộ nhớ có mốc mới hơn sẽ **không** bị bản Sheet cũ ghi đè —
> tránh lỗi “đổi PIN xong bị đăng xuất / phiếu vừa tạo biến mất”.

## 4. Chỉ phiếu ĐÃ DUYỆT mới đồng bộ

### 4.1. Google Drive

- Root mặc định: `1ZX8PitPsemXHjZz7ftPJR-Y10PgWOb-h`
  (có thể override bằng `GOOGLE_DRIVE_VIOLATION_ROOT_ID`).
- Cây thư mục:
  `05. LỖI VI PHẠM QUY CHẾ CÔNG TY → THÁNG <MM.YYYY> → <CHI NHÁNH> → NGÀY <DD-MM-YYYY> → <TÊN NHÂN VIÊN>`
- File: `PHIẾU LỖI VI PHẠM ĐÃ DUYỆT - <MÃ PHIẾU>.pdf` (PDF tiếng Việt, font Be Vietnam Pro).
- Nếu root đã trỏ đúng vào thư mục `05. ...` thì bỏ qua đoạn `05. ...` khi tạo cây.
- Lỗi Drive được ghi vào `drive_sync_status` / `drive_sync_error`; màn hình Đã duyệt có nút
  **Đồng bộ Drive** để thử lại, không làm hỏng thao tác duyệt.

### 4.2. TRỪ KPI (kế toán)

Khi duyệt phiếu:

1. Cộng `total_amount` vào `tru_kpi` của nhân viên trong kỳ lương `YYYY-MM` của ngày vi phạm
   (tab `DULIEU_LUONG_KY`).
2. Nối vào `Ghi chú` các dòng:
   - `[VI PHẠM DD/MM/YYYY] Phiếu <MÃ> — Tổng phạt <số tiền>`
   - `[VI PHẠM DD/MM/YYYY] <tên quy chế>: <mức phạt>`
3. Phát realtime `data:updated` với `entity=payroll` (action `violation-approve`) để cổng kế toán
   tự tải lại bảng lương.
4. Các trường `payroll_applied_amount`, `payroll_applied_at`, `payroll_period` chống cộng trùng.

## 5. Phát triển & build

```bash
# Dev frontend (Vite cổng 3007, proxy /api -> backend 4005)
npm run dev:violation

# Build riêng
npm run build:violation

# Build toàn hệ thống (đã bao gồm violation-web)
npm run build
```

Mở dev: `http://localhost:3007/violations/`.

## 6. Triển khai VPS

- `deploy/vps/deploy.sh` build `@ubm/violation-web` và copy vào `/opt/ubm/violation-web/`.
- `deploy/vps/nginx/ubm.conf` thêm:
  - `/violations` → 301 `/violations/`
  - `/violations/` → static app (SPA fallback `index.html`)
  - `/violations/assets/` → cache 7 ngày
- Backend cũng tự phục vụ `apps/violation-web/dist` tại `/violations/` khi chạy độc lập.
- App gọi API qua `/api/violations/*` (Nginx strip `/api`), Socket.IO cùng origin.
- Nếu chạy trực tiếp backend tại `:4005/violations/`, client tự fallback sang `/violations/*`.
- Cần cấu hình Google OAuth/Service Account hợp lệ trên VPS để upload PDF; nếu chưa, phiếu vẫn
  duyệt + cập nhật KPI bình thường và hiển thị trạng thái Drive lỗi để đồng bộ lại sau.
