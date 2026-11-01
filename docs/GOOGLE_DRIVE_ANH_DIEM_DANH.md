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

Có thể dán tay, hoặc dùng script cập nhật `.env` an toàn (tự sao lưu file cũ,
nhập Secret/Refresh Token ẩn để không lọt vào lịch sử shell). Chạy trên VPS tại
thư mục gốc dự án:

```bash
node deploy/vps/set-google-oauth.cjs
```

Trên máy cá nhân, dùng lệnh sau để in lại 4 dòng cấu hình từ
`apps/backend/.env` cho dễ copy:

```bash
node scripts/print-google-oauth-env.cjs
```

Restart backend bằng Docker (không dùng `pm2`, backend chạy trong container nên
phải tạo lại container mới nạp `.env`):

```bash
docker compose up -d --force-recreate backend
```

Kiểm tra:

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

### 2.4. Đưa OAuth app sang “In production” (bỏ mốc hết hạn 7 ngày)

Theo tài liệu Google: project có OAuth consent screen kiểu **External** và trạng
thái **Testing** sẽ cấp refresh token **hết hạn sau 7 ngày**. Đây là lý do token
hiện tại sẽ chết vào khoảng 07/11/2026 nếu không Publish.

Cách bỏ mốc 7 ngày:

1. Mở <https://console.cloud.google.com/apis/credentials/consent>
2. Bấm **Publish app** → **Confirm** để trạng thái thành **In production**.
3. Nếu Google yêu cầu xác minh (scope `drive` là restricted scope), app vẫn dùng
   được ở trạng thái “chưa xác minh” cho tối đa 100 người dùng, chỉ hiện màn hình
   cảnh báo khi cấp quyền. Với 1 tài khoản nội bộ thì không cần chờ xác minh.
4. **Lấy lại refresh token SAU khi đã Publish** rồi cập nhật `.env`:

```powershell
node scripts/get-google-oauth-refresh-token.cjs
# rồi trên VPS:
node deploy/vps/set-google-oauth.cjs
docker compose up -d --force-recreate backend
```

> Vì sao phải lấy lại token: hạn 7 ngày được gắn vào token **lúc cấp**. Token
> đang dùng được cấp khi app còn Testing nên vẫn hết hạn đúng ngày cũ, dù sau đó
> đã Publish. Token cấp sau khi Publish mới là token dài hạn.

**Sau khi Publish, token còn có thể mất trong các trường hợp** (theo chính sách
Google, không phải lỗi hệ thống):

| Nguyên nhân | Có gặp với UBM? |
|---|---|
| Người dùng thu hồi quyền app trong trang tài khoản Google | Có thể (thao tác tay) |
| Token không dùng quá **6 tháng** | Không — hệ thống upload ảnh hằng ngày |
| Đổi mật khẩu Gmail **và** token chứa scope Gmail | Không — app chỉ xin scope `drive` |
| Vượt **100 refresh token** cho cùng client + tài khoản | Tránh bằng cách không tạo token liên tục |
| Quản trị viên Workspace chặn scope | Không — Gmail cá nhân |

Nghĩa là Publish là đủ cho nhu cầu “dùng mãi”, miễn là **không tạo lại token
nhiều lần** và **không thu hồi quyền**.

### 2.5. Phương án “không có token để hết hạn”: GAS Webhook

Nếu muốn **chắc chắn 100% không bao giờ phải gia hạn token**, dùng Apps Script
Webhook (mục 3). Khi đã cấu hình `GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL`, backend
**ưu tiên upload và đọc ảnh qua webhook**; script chạy dưới quyền chủ thư mục
nên **không tồn tại refresh token** — không có gì hết hạn.

| Tiêu chí | OAuth2 (Publish) | GAS Webhook |
|---|---|---|
| Hết hạn token | Không (sau khi Publish + lấy lại token) | Không có token |
| Rủi ro còn lại | Thu hồi quyền / 6 tháng không dùng | Google Apps Script đổi chính sách |
| Tốc độ upload | Nhanh (~0,5–1 s) | Chậm hơn (~1–3 s) |
| Hạn mức | Drive API quota | Apps Script quota (URL fetch 20k/ngày) |
| Cần đăng nhập Google | Có (1 lần) | Có (1 lần, lúc deploy script) |
| Cần xác minh app | Có thể (scope `drive`) | Không |

**Khuyến nghị:** Publish OAuth **và** cấu hình thêm webhook làm dự phòng. Hai
đường độc lập nhau, một đường chết thì đường còn lại vẫn đẩy ảnh lên Drive.

Sau khi có Web app URL + secret:

```bash
# Trên VPS, tại thư mục gốc dự án
node deploy/vps/set-drive-webhook.cjs
#   -> nhập Web app URL và WEBHOOK_SECRET (secret nhập ẩn, .env tự sao lưu)

node scripts/test-drive-webhook.cjs      # kiểm tra URL + secret, không tạo file rác
docker compose up -d --force-recreate backend
```

`/api/health` phải hiện `"webhookConfigured": true`. Từ lúc đó ảnh mới được đẩy
qua webhook trước, OAuth chỉ là đường dự phòng.

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
| Container báo `unhealthy` nhưng `/health` vẫn OK | Healthcheck gọi `localhost` → ra IPv6 `::1`, node chỉ listen IPv4 | Đặt healthcheck dùng `127.0.0.1` (xem mục 7.4) |
| Log có `Quota exceeded ... Read requests per minute per user` | Nhiều lượt đọc Sheets trong 1 phút (pull định kỳ + script chẩn đoán) | Giãn `SHEETS_SYNC_INTERVAL_MS`, tránh chạy script song song lúc pull |

## 7. Ghi chú vận hành thực tế (production, 01/11/2026)

### 7.1. Mỗi tab có thể nằm ở một Spreadsheet riêng

`config/sheets-mapping.ts` khai báo `SEPARATED_SHEETS_MAP`: một số tab **không**
nằm trong file tổng `SPREADSHEET_ID` mà ở file riêng do khách hàng tách ra.
Ví dụ tab `SU_KIEN_DIEM_DANH` nằm ở:

```
1n8zK3R7ZS8WV2wdLBmDegrxe6qKkRk6NDn3skKKZ374   # tab thật, app đọc/ghi
1UO1UF1d7_YzaCltYt2m9pRnUauGWw873ERqAMxwL-6k   # spreadsheet tổng (chỉ là bản mirror)
```

Vì vậy khi sửa dữ liệu bằng script **phải** lấy đúng ID:

```js
const { getSpreadsheetIdForTab } = require('/app/apps/backend/dist/config/sheets-mapping.js');
const sid = getSpreadsheetIdForTab('SU_KIEN_DIEM_DANH', process.env.SPREADSHEET_ID);
```

Ghi nhầm vào file tổng sẽ “thành công” nhưng app không hề nhận được ID, và lần
pull sau giá trị trong tab thật lại ghi đè ngược vào bộ nhớ.

Thứ tự ưu tiên khi merge: **giá trị trong Sheet thắng bộ nhớ** (`mergeById`), nên
muốn sửa ID cho ảnh cũ thì sửa thẳng cột `Ảnh Drive Object` trong tab thật rồi
để app pull lại (không cần sửa snapshot bằng tay).

### 7.2. Kết quả backfill ảnh cũ

- Đã upload **200 ảnh** (140 sự kiện duy nhất, gồm cả ảnh trùng ngày/loại) lên
  đúng cây `CN…/YYYY-MM-DD/Tên NV/…` trong thư mục `04. ĐIỂM DANH`.
- Đã ghi ID thật vào 199 dòng của tab thật; sau đó `photo-stats` trả về
  `withPhoto` đúng theo từng ngày (ví dụ 31/10: 22/24, 01/11: 5/5).
- Snapshot giảm từ ~184 MB xuống ~95 MB sau khi bỏ base64 inline.
- API `GET /attendance/photo/<event_id>` trả `image/jpeg` ~400 KB đọc trực tiếp
  từ Drive (kiểm tra bằng `curl -o anh.jpg` rồi mở file).

Các sự kiện còn `DRV_LOCAL_`/trống là ảnh **đã bị lược khỏi bộ nhớ và không còn
trên đĩa** (thư mục `data/attendance-photos` chỉ còn 9 file) → không thể phục
hồi; cần nhân viên chụp lại hoặc bổ sung công.

### 7.3. Giới hạn quota Google Sheets

Service Account chỉ được khoảng **60 lượt đọc/phút/user**. Một lượt pull đầy đủ
đọc ~27 tab, cộng thêm đọc lịch PV/Zalo và script chẩn đoán sẽ vượt hạn mức và
trả `429`. Cấu hình khuyến nghị trên VPS:

```env
SHEETS_SYNC_INTERVAL_MS=60000      # pull chính mỗi 60 giây
SHEETS_HISTORY_PULL_MS=300000      # pull lịch sử mỗi 5 phút
```

Khi chạy script kiểm tra/sửa dữ liệu, nên dừng backend hoặc chờ giữa các lần
chạy để tránh 429.

### 7.4. Healthcheck trong Docker

Trong container, `localhost` phân giải ra `::1` trước, còn Node chỉ listen IPv4
`0.0.0.0:4005`. Healthcheck mặc định gọi `http://localhost:4005/health` nên luôn
báo `Connection refused` và container bị đánh dấu `unhealthy` dù ứng dụng vẫn
chạy bình thường. Đặt trong `docker-compose.override.yml`:

```yaml
services:
  backend:
    environment:
      NODE_OPTIONS: "--max-old-space-size=3072"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4005/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

### 7.5. Kiểm tra nhanh sau khi sửa

```bash
# 1. Đếm ID thật / DRV_* / trống trong tab thật (chạy trong container)
docker compose exec -T backend node -e '
const {google}=require("/app/node_modules/googleapis");
const {getSpreadsheetIdForTab}=require("/app/apps/backend/dist/config/sheets-mapping.js");
const p=(r)=>{try{return JSON.parse(r)}catch{}};
(async()=>{const a=new google.auth.GoogleAuth({credentials:p(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),scopes:["https://www.googleapis.com/auth/spreadsheets"]});
const s=google.sheets({version:"v4",auth:a});
const r=await s.spreadsheets.values.get({spreadsheetId:getSpreadsheetIdForTab("SU_KIEN_DIEM_DANH",process.env.SPREADSHEET_ID),range:"SU_KIEN_DIEM_DANH!A1:J"});
const rows=(r.data.values||[]).slice(1);let real=0,drv=0,empty=0;
for(const x of rows){const id=String(x[9]||"");if(!id)empty++;else if(id.startsWith("DRV_"))drv++;else real++;}
console.log({tong:rows.length,real,drv,empty});})();'

# 2. Xem 1 ảnh bất kỳ qua API (thay <id> bằng event_id)
curl -s -o /tmp/a.jpg -w '%{http_code} %{content_type} %{size_download}\n' \
  https://<domain>/api/attendance/photo/<event_id>
```

Lưu ý: token đang dùng được cấp khi app còn *Testing* nên sẽ hết hạn khoảng
07/11/2026. Publish app chỉ bỏ hạn 7 ngày cho **token cấp sau đó** — phải chạy
lại `get-google-oauth-refresh-token.cjs` rồi cập nhật `.env` (mục 2.4). Muốn
không phụ thuộc token, bật thêm GAS Webhook (mục 2.5).
