# Ảnh điểm danh (Check-in / Check-out) trên Google Drive

Tài liệu vận hành cho thư mục **04. ĐIỂM DANH (CHECK-IN + CHECK-OUT)**.

## 1. Vì sao ảnh không lên Drive?

Service Account (`...@....iam.gserviceaccount.com`) **không có dung lượng** trên
Google Drive cá nhân (My Drive). Mọi lần tạo file đều bị Google từ chối với lỗi:

```
Service Accounts do not have storage quota.
```

Khi đó backend vẫn giữ ảnh trên đĩa VPS và ghi `DRV_LOCAL_...` vào cột
`Ảnh Drive Object` của sheet `SU_KIEN_DIEM_DANH`. Ảnh vẫn xem được tạm thời
(inline/đĩa) nhưng **không có trên Drive**, và sau khi đĩa bị dọn/rebuild là mất.

Có 2 cách cấp quyền ghi Drive đúng:

| Cách | Phù hợp | Cần làm |
|------|---------|---------|
| **OAuth2 (khuyến nghị)** | Gmail cá nhân sở hữu thư mục | Tạo OAuth Client + lấy refresh token |
| **GAS Webhook** | Không muốn tạo OAuth | Deploy 1 Apps Script chạy dưới quyền chủ thư mục |
| Service Account + Shared Drive | Google Workspace | Thêm SA làm Content Manager của Shared Drive |

Hệ thống tự chọn theo thứ tự: **OAuth2 → Service Account**, và luôn thử
**Webhook** trước nếu được cấu hình.

## 2. Cách 1 — OAuth2 (khuyến nghị)

### 2.1. Tạo OAuth Client

1. Mở <https://console.cloud.google.com/apis/credentials>
2. Chọn đúng project đang dùng (project của Service Account hiện tại).
3. Bật **Google Drive API** (APIs & Services → Library → Google Drive API → Enable).
4. **Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Đặt tên: `UBM HR Drive`
5. Copy **Client ID** và **Client secret**.

> Nếu màn hình OAuth consent yêu cầu, chọn External + thêm chính email
> `umbomilk@gmail.com` vào **Test users**.

### 2.2. Lấy refresh token

Trên máy có trình duyệt (không cần làm trên VPS):

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID="xxxx.apps.googleusercontent.com"
$env:GOOGLE_OAUTH_CLIENT_SECRET="xxxx"
node scripts/get-google-oauth-refresh-token.cjs
```

Trình duyệt mở ra → đăng nhập **đúng tài khoản Gmail sở hữu thư mục Drive** →
bấm **Cho phép**. Script in ra 4 dòng cấu hình.

### 2.3. Dán vào `.env` trên VPS

```env
GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=xxxx
GOOGLE_OAUTH_REFRESH_TOKEN=xxxx
GOOGLE_OAUTH_ACCOUNT_EMAIL=umbomilk@gmail.com

# Thư mục gốc 04. ĐIỂM DANH (mặc định đã đúng, khai báo để rõ ràng)
GOOGLE_DRIVE_ATTENDANCE_FOLDER_ID=1vql_oCLqsyDdvMlh_XIIhPhLuFWq387G
```

Restart backend. Kiểm tra:

```bash
curl -s https://<domain>/api/health | grep -A12 '"drive"'
```

Kết quả đúng phải có:

```json
"drive": {
  "driveConfigured": true,
  "authMode": "oauth",
  "authAccount": "umbomilk@gmail.com",
  "authLabel": "OAuth2 (umbomilk@gmail.com)",
  "attendanceRootFolderId": "1vql_oCLqsyDdvMlh_XIIhPhLuFWq387G",
  "lastError": null
}
```

## 3. Cách 2 — GAS Webhook (không cần OAuth)

1. Mở <https://script.google.com> → **New project**.
2. Dán nội dung file [`apps/backend/drive-upload-webhook.gs`](../apps/backend/drive-upload-webhook.gs).
3. **Project Settings → Script properties** → thêm `WEBHOOK_SECRET = <chuỗi bí mật>`.
4. **Deploy → New deployment → Web app**
   - Execute as: **Me** (tài khoản sở hữu thư mục Drive)
   - Who has access: **Anyone**
5. Copy **Web app URL**, thêm vào `.env` rồi restart:

```env
GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
GOOGLE_DRIVE_WEBHOOK_SECRET=<đúng WEBHOOK_SECRET>
```

Webhook tự tạo cây thư mục con (`Chi nhánh / Ngày / Tên NV`) và **đọc lại file**
khi UI cần hiển thị, nên ảnh vẫn xem được dù backend không có quyền Drive.

## 4. Cấu trúc thư mục được ghi

```
04. ĐIỂM DANH (CHECK-IN + CHECK-OUT)/
└── CN1 - 130 Vạn Kiếp/
    └── 2026-10-31/
        └── Nguyễn Văn A/
            ├── check in.jpg
            └── check out.jpg
```

Thư mục chi nhánh lấy theo `branch_id` của nhân viên. Có thể ghi đè ID từng
chi nhánh bằng env (không cần sửa code):

```env
GOOGLE_DRIVE_ATTENDANCE_FOLDER_CN1=...
GOOGLE_DRIVE_ATTENDANCE_FOLDER_CN130=...   # ưu tiên mã thô trước
GOOGLE_DRIVE_ATTENDANCE_FOLDER_CN2=...
GOOGLE_DRIVE_ATTENDANCE_FOLDER_CN3=...
GOOGLE_DRIVE_ATTENDANCE_FOLDER_CN4=...
GOOGLE_DRIVE_ATTENDANCE_FOLDER_XUONG=...
GOOGLE_DRIVE_ATTENDANCE_FOLDER_VANPHONG=...
```

Nếu ID cấu hình không truy cập/ghi được, backend tự tạo thư mục chi nhánh
tương ứng dưới `04. ĐIỂM DANH` để ảnh vẫn lên Drive thay vì `DRV_LOCAL`.

## 5. Phục hồi ảnh cũ (DRV_LOCAL)

Ảnh check-in/out đã lưu trước đây có thể phục hồi **nếu còn bản trên đĩa VPS**
(`ATTENDANCE_PHOTO_DIR`, mặc định `data/attendance-photos`) hoặc còn inline
trong bộ nhớ. Job nền tự thử lại mỗi 5 phút.

Chạy bù ngay sau khi cấu hình Drive (ADMIN/HR):

```bash
# Thử upload các ảnh còn kẹt trong bộ nhớ/đĩa
curl -X POST https://<domain>/api/admin/attendance/photos-retry \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"limit":50}'

# Đồng bộ ảnh theo ngày (đọc cả kho lưu trữ + đĩa đệm)
curl -X POST https://<domain>/api/admin/attendance/photos-sync \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"date":"2026-10-30"}'

# Hoặc quét 7 ngày gần nhất
curl -X POST https://<domain>/api/admin/attendance/photos-sync \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"days":7}'
```

Ảnh **không còn trên đĩa và không còn inline** thì không thể phục hồi (dữ liệu
gốc đã mất) — cần nhân viên chụp lại hoặc dùng phiếu bổ sung công.

## 6. Chẩn đoán nhanh

| Triệu chứng | Nguyên nhân | Xử lý |
|-------------|-------------|-------|
| `/health` → `authMode: "service-account"` | Chưa cấu hình OAuth | Làm mục 2 |
| `lastError` chứa `storage quota` | SA ghi My Drive | Cấu hình OAuth hoặc webhook |
| `lastError` chứa `invalid_grant` | Key SA hết hiệu lực | Tạo key mới hoặc dùng OAuth |
| `lastError` chứa `404` | Sai folder ID / chưa share | Kiểm tra `GOOGLE_DRIVE_ATTENDANCE_FOLDER_ID` |
| Ảnh có ID thật nhưng UI trắng | Backend không đọc được file | Bật OAuth hoặc webhook (mục 3) |
| Cột Drive vẫn `DRV_LOCAL_` | Upload chưa chạy lại | Gọi `photos-retry` / `photos-sync` |
