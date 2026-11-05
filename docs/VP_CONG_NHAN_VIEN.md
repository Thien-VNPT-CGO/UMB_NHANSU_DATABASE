# Nhân viên Văn Phòng — Cổng Nhân viên (V5.1) + Duyệt (Admin)

Áp dụng cho nhân sự có `group = 'VAN_PHONG'` (khối văn phòng). Nhân viên cửa hàng/xưởng/thử việc/chính thức giữ nguyên bộ tab và luồng cũ.

## 8 Tab cổng nhân viên

| # | Tab | Ghi chú |
|---|-----|---------|
| 1 | Trang chủ | giữ nguyên |
| 2 | Lịch làm việc | lịch hành chính cố định: T2–T6 08:00–17:00, T7 08:00–12:00, CN nghỉ |
| 3 | Đăng ký nghỉ phép | 1 ngày/tháng; phiếu duyệt tuần tự **Nhân sự → Kế toán → Giám đốc**; chỉ hiệu lực khi Giám đốc duyệt |
| 4 | Điểm danh | nút **VÀO CA** chỉ hiện trong khung 08:00–08:30 (giờ VN); **RA CA** sau khi vào ca; GPS realtime trong bán kính **300m** của Văn Phòng Trụ Sở Chính mới hiện nút (>150m sai số bị chặn) |
| 5 | Công của tôi | **lương cơ bản theo THÁNG** = Lương CB + Phụ cấp (Kế toán cấu hình, không tính theo ca); ngày công/tổng giờ chỉ để theo dõi |
| 6 | Bổ sung công | tối đa **4 phiếu/tháng**; dùng hết thì khóa tới tháng sau |
| 7 | Thông báo & Lương | giữ nguyên |
| 8 | Hồ Sơ | giữ nguyên |

## API mới

| Endpoint | Mô tả |
|---|---|
| `GET /me/office/schedule?fromDate&toDate` | lịch hành chính + trạng thái điểm danh/nghỉ phép đã duyệt |
| `GET /me/office/timesheet?period=YYYY-MM` | công + **lương cơ bản theo tháng** (LCB + phụ cấp) |
| `GET /me/office/attendance?fromDate&toDate` | sự kiện vào/ra ca |
| `GET /me/office/attendance/state` | trạng thái hôm nay + khung giờ mở nút |
| `POST /me/office/checkin` | GPS + giờ server (08:00–08:30) chốt cứng |
| `POST /me/office/checkout` | sau khi đã vào ca |
| `GET /me/office/leaves` · `POST /me/office/leaves` | phiếu nghỉ `{date, reason}` — 1 ngày/tháng; quota trả kèm trong response |
| `GET /me/office/adjustments` · `POST /me/office/adjustments` | bổ sung công — 4 phiếu/tháng |
| `GET /office/leaves` · `POST /office/leaves/:id/review` | hàng đợi duyệt nghỉ phép (HR/FINANCE/DIRECTOR) |
| `GET /office/adjustments` · `POST /office/adjustments/:id/review` | hàng đợi duyệt bổ sung công (HR/DIRECTOR) |
| `GET /office/employees` | danh sách NV Văn Phòng + lương tháng (LCB + phụ cấp, chỉ đọc) |
| `GET /salary-config` · `PUT /salary-config/:employeeId` | Kế toán/Admin cấu hình hình thức + LCB + phụ cấp từng NV (xem `LUONG_CO_BAN_THEO_KHOI.md`) |

## Quy tắc nghiệp vụ (server chốt cứng)

- **Nghỉ phép**: tối đa 1 ngày/tháng (dựa trên PENDING/APPROVED cùng tháng); chỉ chọn ngày hiện tại/tháng hiện tại; ngày CN không cần đăng ký.
- **Chuỗi duyệt**: `PENDING_HR → PENDING_FINANCE → PENDING_DIRECTOR → APPROVED`; bất cứ bước nào cũng có thể `REJECTED`. Mỗi vai trò chỉ duyệt đúng bước của mình (ADMIN duyệt thay được).
- **Điểm danh**: server chặn ngoài khung 08:00–08:30, ngoài bán kính 300m, và sai số GPS > 150m.
- **Bổ sung công**: 4 phiếu/tháng (PENDING + APPROVED chiếm quota); hết tháng tự mở lại; REJECTED không chiếm quota.
- **Lương Văn Phòng**: lương cơ bản theo **tháng** = Lương CB + Phụ cấp, do **Kế toán/Admin** cấu hình tại tab "Cấu hình Lương CB & Phụ cấp" (HR chỉ xem). HR không còn quyền sửa lương/phúc lợi.

## Bền vững dữ liệu

Văn phòng dùng tính năng bền vững qua `systemSettings` (đồng bộ `CAU_HINH_HE_THONG` trên Google Sheets), cùng mẫu với đổi STK — không đổi schema `NHAN_VIEN_MASTER`, không ghi vào `SU_KIEN_DIEM_DANH`.

## Admin (duyệt phiếu)

Thêm tab **"Duyệt Văn Phòng"** cho HR / FINANCE / DIRECTOR (ADMIN cũng có):
- Cột trái: Nghỉ phép (hiện đúng bước cần duyệt theo vai trò; Giám đốc duyệt xong mới có hiệu lực).
- Bổ sung công (HR/Giám đốc duyệt).
- Đã bỏ mục "Lương & Phúc lợi VP": lương/phụ cấp do Kế toán cấu hình tại tab riêng, HR chỉ xem.
