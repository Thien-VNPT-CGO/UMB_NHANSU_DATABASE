# Tòa Án Tối Cao Ụm Bò Milk — Hệ thống kiểm soát & xử lý vi phạm

Web app riêng, phục vụ tại `https://<domain>/violations/`, dùng chung backend và kho dữ liệu
(Google Sheets / PostgreSQL) của hệ thống nhân sự.

## 1. Đăng nhập

- Tài khoản hiển thị: **Tòa Án Tối Cao Ụm Bò Milk — HỆ THỐNG KIỂM SOÁT & XỬ LÝ VI PHẠM**.
- Chỉ cần **PIN 8 chữ số**. PIN mặc định lần đầu: `12345678`.
- Lần đăng nhập đầu tiên (hoặc sau khi cấp lại PIN) bắt buộc đổi PIN trước khi dùng chức năng.
- Cấp lại mật khẩu: đặt PIN về `68686868`, tăng `pin_version` (thu hồi mọi phiên cũ) và hiển thị
  thông điệp *“Vui lòng liên hệ Admin để lấy mã PIN.”* Đăng nhập lại bằng PIN cấp lại rồi đổi PIN mới.
- Token riêng `typ=violation-access`, hạn 12 giờ; không dùng token nhân viên/admin.

## 2. Chức năng

| Chức năng | Mô tả |
| --- | --- |
| Quy chế Công Ty | Tra cứu lỗi vi phạm, nhóm và mức phạt đang áp dụng. |
| Bắt Lỗi Vi Phạm | Chọn nhân viên (tên + chi nhánh), thêm nhiều lỗi, sửa mức phạt, tự cộng tổng. |
| Lỗi Vi Phạm Chưa Duyệt | Phiếu `Lưu tạm`; có thể xem, duyệt hoặc xóa. |
| Lỗi Vi Phạm Đã Duyệt | Kho phiếu đã duyệt, trạng thái PDF Drive + TRỪ KPI. |
| Điều Chỉnh Quy Chế | Thêm / sửa / xóa quy chế, đồng bộ realtime sang Quy chế Công ty. |
| Đổi Mật Khẩu | Đổi PIN 8 số và cấp lại mật khẩu khẩn cấp. |
| Thông Tin Cá Nhân | Hiển thị đầy đủ 10 thẩm quyền tối cao và dấu ấn phiên. |

## 3. Lưu trữ dữ liệu

Các khóa trong system settings (tab `CAU_HINH_HE_THONG` của kho dữ liệu):

- `violationRegulations` — danh sách quy chế + mức phạt.
- `violationTickets` — toàn bộ phiếu vi phạm (chưa duyệt + đã duyệt).
- `violationPortalAccount` — tài khoản cổng, hash PIN, `pin_version`, `must_change_pin`.

Dữ liệu đi theo luồng `updateSystemSettings` sẵn có nên tự đồng bộ Google Sheets (hoặc PostgreSQL
khi `DATA_STORE=postgres`). Không cần thêm bảng riêng.

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
