# UBM HR — Kiến trúc PostgreSQL + Google Drive

> Trạng thái: đã chuyển backend sang PostgreSQL là nguồn sự thật.
> Google Sheets chỉ còn là kênh **export / báo cáo một chiều**. Google Apps Script
> đã bị loại bỏ khỏi hệ thống.

## 1. Kiến trúc

```
Web Admin / Web Nhân viên
        │  REST + Socket.IO (realtime < 1s)
        ▼
Backend Node.js (Express + Socket.IO)
        │
        ├── PostgreSQL  ← nguồn sự thật (dữ liệu chữ)
        │     employees, accounts, shifts, attendance_events, payroll, ...
        │
        ├── Google Drive ← ảnh check-in/out, ảnh bằng chứng, avatar, hợp đồng
        │     04. ĐIỂM DANH / <Chi nhánh> / <YYYY-MM-DD> / <Tên NV> / ảnh
        │
        └── Google Sheets ← export / báo cáo một chiều (không auto pull/push)
```

- Mọi thao tác ghi: cập nhật bộ nhớ nghiệp vụ → ghi PostgreSQL trong cùng request
  (write-through) → trả kết quả → Socket.IO phát `data:updated`.
- Ảnh: lưu đĩa VPS trước, upload Google Drive nền. PostgreSQL chỉ lưu
  `drive_object_id` / `avatar_drive_id` / `evidence_drive_id`.
- Không lưu base64 ảnh trong PostgreSQL. Các trường `photo_base64`, `event_photo`,
  `avatar_photo`, `evidence_photo` bị loại khi serialize xuống DB.
- Khi Drive lỗi, ảnh nằm trên đĩa VPS (`ATTENDANCE_PHOTO_DIR`, mặc định
  `data/attendance-photos`) và được job nền upload lại mỗi 5 phút.

## 2. Cấu hình

Trong `apps/backend/.env`:

```env
DATA_STORE=postgres
DATABASE_URL=postgresql://ubm:matkhau-manh@postgres:5432/ubm_hr
DATABASE_POOL_MAX=10

GOOGLE_SERVICE_ACCOUNT_JSON={...}
GOOGLE_DRIVE_FOLDER_ID=...
GOOGLE_DRIVE_ATTENDANCE_FOLDER_ID=...

# Chờ tối đa 4s cho upload ảnh; quá hạn trả kết quả điểm danh ngay và upload nền.
DRIVE_UPLOAD_BLOCK_MS=4000
```

Mật khẩu PostgreSQL đặt trong `.env` ở thư mục gốc (cho `docker compose`):

```env
POSTGRES_DB=ubm_hr
POSTGRES_USER=ubm
POSTGRES_PASSWORD=matkhau-manh
```

### Google Drive

Service Account chỉ upload được vào **Shared Drive** (Google Workspace) vì tài
khoản dịch vụ không có quota trên My Drive cá nhân. Cách làm:

1. Tạo Shared Drive, tạo cây thư mục `04. ĐIỂM DANH/<Chi nhánh>`.
2. Thêm email Service Account làm **Content Manager** của Shared Drive.
3. Điền ID thư mục chi nhánh trong `apps/backend/src/config/drive-folders.ts`
   hoặc biến môi trường tương ứng.
4. Kiểm tra: `GET /health` → `drive.configured = true`.

Nếu dùng Gmail cá nhân, cần OAuth2 refresh token thay cho Service Account.

## 3. Khởi động

```bash
docker compose up --build -d
docker compose logs -f backend
curl http://localhost:4005/health
```

Lần đầu backend tự tạo schema + seed tài khoản quản trị mặc định. Sau đó chạy
migration dữ liệu thật từ Sheets (mục 4).

## 4. Migration Google Sheets → PostgreSQL

**Dừng backend trước khi chạy** để tránh ghi đè.

```bash
cd apps/backend
npm run migrate:postgres
```

Script sẽ:

1. Đọc toàn bộ tab từ Google Sheets vào bộ nhớ.
2. `TRUNCATE` các bảng nghiệp vụ rồi ghi lại toàn bộ (mặc định REPLACE).
3. Nạp lại từ PostgreSQL để xác minh số lượng.

Tùy chọn:

- `npm run migrate:postgres -- --keep` — chỉ upsert, không xóa dữ liệu cũ.

Sau khi migration xong:

```bash
docker compose up -d backend
curl http://localhost:4005/health
```

Kiểm tra các mục: `postgres.ready`, `postgres.counts`, `drive.configured`,
`mode = POSTGRES`.

## 5. Sao lưu

### PostgreSQL

```bash
# Backup nén
docker compose exec -T postgres \
  pg_dump -U ubm -d ubm_hr -Fc > backup_ubm_$(date +%F).dump

# Phục hồi
docker compose exec -T postgres \
  pg_restore -U ubm -d ubm_hr --clean --if-exists < backup_ubm_2026-10-31.dump
```

Nên chạy `pg_dump` hằng ngày bằng cron và giữ 30 bản gần nhất. Ảnh đã nằm trên
Google Drive nên không cần backup ảnh trong PostgreSQL.

### Google Sheets

Giữ nguyên cơ chế export/backup tháng hiện có (`monthly-backup.service`). Sheets
không còn là nguồn sự thật; mất Sheets không mất dữ liệu nghiệp vụ.

## 6. Tối ưu dung lượng theo tháng

- PostgreSQL chỉ chứa dữ liệu chữ; 300 NV nhiều năm thường chỉ vài GB.
- Bảng lớn nhất là `attendance_events`. Khi vượt ~5–10 triệu dòng hoặc DB > 3–5GB:
  1. Tạo bảng tổng hợp tháng (`attendance_monthly_summary`) từ dữ liệu gốc.
  2. Export chi tiết tháng cũ ra file nén (JSONL/CSV.gz) trên Drive.
  3. Xóa dữ liệu chi tiết cũ khỏi PostgreSQL theo `bucket_month`.
  4. Chỉ partition bảng khi thật sự cần; partition không tự giảm dung lượng.

### Script archive có sẵn

```bash
cd apps/backend

# Xem trước (DRY-RUN): xuất file nén + thống kê, KHÔNG xóa dữ liệu
npm run archive:postgres -- --month=2025-01

# Thực thi: ghi bảng tổng hợp + manifest rồi xóa sự kiện gốc
npm run archive:postgres -- --month=2025-01 --apply
```

Kết quả:

- `data/archives/attendance_events/YYYY-MM.jsonl.gz` — dữ liệu gốc nén.
- `attendance_monthly_summary` — số check-in/out, số ngày công, số lần trễ/sớm,
  giờ vào đầu tiên / ra cuối cùng theo từng nhân viên.
- `archive_manifests` — checksum SHA-256 + số dòng + đường dẫn file.

Tùy chọn: `--force` (ghi đè archive đã tồn tại), `--archive-dir=...` (đổi thư mục).
Sau khi chạy `--apply`, hãy copy file `.jsonl.gz` ra Google Drive/ổ khác trước khi
dọn đĩa VPS.

Chỉ archive khi dữ liệu đã đủ cũ (ví dụ > 24 tháng) và đã đối soát lương. Có thể
dùng `bucket_month` để xóa/archive theo tháng:

```sql
-- Ví dụ: xóa sự kiện chấm công cũ hơn 24 tháng sau khi đã export
DELETE FROM attendance_events
WHERE bucket_month < (CURRENT_DATE - INTERVAL '24 months')::date;
```

- Nén ảnh trên Drive nếu cần: ảnh đã giới hạn ~150KB; 300 NV × 2 ảnh/ngày × 26
  ngày ≈ 2,3GB/tháng.

## 7. Rollback khẩn cấp về Google Sheets

1. Đặt `DATA_STORE=sheets` trong `apps/backend/.env`.
2. `docker compose up -d backend`.
3. Hệ thống chạy lại adapter Sheets cũ; dữ liệu phát sinh trong lúc chạy
   PostgreSQL **không tự chuyển ngược** — cần export/import có kiểm soát.

## 8. Những gì đã bị tắt khi chạy PostgreSQL

- Auto pull Google Sheets mỗi 15 giây.
- Auto push ngược toàn bộ tab lên Sheets mỗi 60 phút.
- Webhook Apps Script `/hooks/sheets-edit` (trả HTTP 410).
- Lưu trữ tuần tự động cắt dữ liệu khỏi bộ nhớ (dữ liệu nằm trong PostgreSQL).
- Probe ghi Google Sheets và hàng đợi durable write.

Các chức năng export/báo cáo/backup tháng vẫn dùng Google Sheets nhưng chỉ chạy
khi được gọi thủ công hoặc theo lịch backup, không đồng bộ hai chiều.
