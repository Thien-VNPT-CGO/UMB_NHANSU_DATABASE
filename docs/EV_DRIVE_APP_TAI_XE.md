# Đồng bộ App Tài Xế lên Google Drive

Tài liệu vận hành cấu trúc Drive của phân hệ **MilkRoute EV / App Tài Xế**.
Mã nguồn: `apps/backend/src/services/milkroute/ev-drive.service.ts`.

## 1. Nguyên tắc

- **Toàn bộ thông tin** phát sinh từ App Tài Xế đều được ghi lên Google Drive:
  ca, điểm dừng, GPS, phiếu sạc, giải trình + ảnh bằng chứng, lương, hồ sơ tài xế,
  lộ trình, phiếu đổi lộ trình và số liệu tổng quan.
- **Drive thiếu thì tự tạo:** mỗi lần đồng bộ đều bảo đảm đủ thư mục/tệp của
  từng tab, kể cả tab chưa có dữ liệu.
- **Chức năng mới tự có mục:** khi kho dữ liệu xuất hiện mảng `ev*` mới chưa
  thuộc tab nào, hệ thống tự tạo thư mục `Tự động - <tên chức năng>` kèm dữ liệu
  và danh mục. Chỉ cần thêm chức năng vào backend là Drive tự mở rộng.
- **Tự cập nhật lại:** lỗi ghi Drive được thử lại sau 5 phút (tối đa 3 lần);
  quét lại 6 giờ/lần; khi khởi động tự bù các ngày gần đây có dữ liệu.

## 2. Cây thư mục

```
04. VẬN CHUYỂN SỮA/
├── DANH-MUC-CHUC-NANG.json          # Mục lục gốc, tự cập nhật khi có tab mới
└── THANG_MM/
    └── DD-MM-YYYY/
        ├── 00-DANH-MUC.json          # Mục lục các tab của ngày
        ├── Live Map/
        │   ├── vi-tri-DD-MM-YYYY.json
        │   └── danh-muc.json
        ├── Xe & Lộ trình/
        │   ├── xe.json
        │   ├── lo-trinh.json
        │   └── danh-muc.json
        ├── Phiếu đổi lộ trình/
        ├── Ca vận chuyển/
        ├── Phiếu sạc/
        ├── Lương tài xế/             # + cau-hinh-luong.json
        ├── Giải trình/               # + Anh bang chung/<ticket>/...
        ├── Hồ sơ tài xế/
        ├── Hành trình GPS/
        ├── Tổng quan/
        └── Tự động - <chức năng mới>/
```

Mỗi thư mục tab luôn có `danh-muc.json` mô tả: chức năng, nguồn dữ liệu, tên tệp,
số bản ghi và danh sách cột.

## 3. Liên hệ với 6 tab App Tài Xế

| Tab App Tài Xế | Thư mục Drive |
| --- | --- |
| Hôm nay | `Tổng quan`, `Ca vận chuyển` |
| Bản đồ | `Live Map`, `Hành trình GPS` |
| Sạc xe | `Phiếu sạc` |
| Thu nhập | `Lương tài xế` |
| Giải trình | `Giải trình` (kèm ảnh bằng chứng) |
| Tôi | `Hồ sơ tài xế` |

## 4. Cấu hình

| Biến môi trường | Ý nghĩa | Mặc định |
| --- | --- | --- |
| `GOOGLE_DRIVE_EV_ROOT_ID` | ID thư mục gốc `04. VẬN CHUYỂN SỮA` | ID do chủ dự án cấp |
| `GOOGLE_DRIVE_EV_BACKFILL_DAYS` | Số ngày tự bù khi khởi động | `7` (tối đa 31) |
| `GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL` | Apps Script ghi Drive dưới quyền chủ thư mục | — |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_OAUTH_*` | Đường ghi Drive API dự phòng | — |

Chỉ cần 1 trong các đường ghi Drive ở trên là đồng bộ hoạt động.

## 5. API quản trị

- `GET /ev/admin/drive/status` — trạng thái, danh sách tab, tab tự động, lỗi gần nhất.
- `POST /ev/admin/drive/sync` — đồng bộ ngay.
  - `{ "date": "2026-11-13" }` hoặc `{ "from": "...", "to": "..." }` (tối đa 31 ngày).
- Mọi thao tác của tài xế/admin đều tự kích hoạt đồng bộ (debounce 8 giây).

## 6. Thêm chức năng mới

1. Thêm dữ liệu vào kho dữ liệu với tên mảng bắt đầu bằng `ev...`.
2. Nếu muốn tab riêng có cấu trúc đẹp: khai báo thêm một `EVDriveTabDef` trong
   `knownTabDefs()` (tên tab, mô tả, nguồn dữ liệu, tên tệp, hàm dựng dữ liệu).
3. Nếu chưa kịp khai báo: hệ thống vẫn tự tạo mục `Tự động - <tên chức năng>`
   và ghi dữ liệu theo ngày, không cần sửa code Drive.
