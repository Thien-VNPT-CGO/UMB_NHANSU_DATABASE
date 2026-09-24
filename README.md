# HỆ THỐNG QUẢN LÝ NHÂN SỰ ỤM BÒ MILK V5.1 (UMBO MILK HR SYSTEM)

> Hệ thống Quản trị Nhân sự Toàn diện & Điểm danh Thời gian thực (Realtime Attendance, GPS Geofencing, Google Sheets Master Database & Zalo Personal Bot).

---

## 🌟 TỔNG QUAN HỆ THỐNG

Hệ thống Quản lý Nhân sự Ụm Bò Milk V5.1 được xây dựng theo kiến trúc Monorepo hiện đại gồm 3 phân hệ chính:

1. **Cổng Quản Trị Hệ Thống (Admin Web Portal - `apps/admin-web`):**
   - Phân quyền nghiêm ngặt theo 5 vai trò tài khoản:
     - **ADMIN (12 Tabs):** Quản trị tài khoản, phân quyền, cấu hình chi nhánh, audit log, backup & recovery, cài đặt hệ thống.
     - **HR (15 Tabs):** Quản lý ứng viên, phỏng vấn tích hợp Zalo cá nhân & Google Meet, nhân viên thử việc (12 ngày), chính thức, lịch làm việc tuần, đổi ca & điều phối nhường ca (+30.000đ/ca phụ cấp), nghỉ khẩn cấp, chấm công realtime, ngân hàng câu hỏi & bài thi TEST 25 câu.
     - **STORE (10 Tabs):** Giám sát vận hành cửa hàng theo chi nhánh cụ thể (CN130, CN120, CN261, CN111), điểm danh realtime, duyệt ca làm.
     - **FINANCE (11 Tabs):** Bảng chấm công, đối soát công, kỳ lương, tính lương tự động, phiếu lương nhân viên.
     - **MARKETING (9 Tabs):** Tạo và phát thông báo truyền thông, campaign, quản lý media.

2. **Cổng Nhân Viên (Employee Web App - `apps/employee-web`):**
   - Thiết kế tối ưu cho điện thoại di động (PWA Mobile First).
   - **Nhân viên Thử việc (9 Tabs):** Chu kỳ 12 ngày (7 làm / 5 nghỉ), tự đổi ca tự do (Ca làm ⇄ Nghỉ OFF), làm bài thi TEST 25 câu.
   - **Nhân viên Chính thức (9 Tabs):** Lịch làm việc tuần, đăng ký OFF tuần, đổi ca 2 hình thức (Tráo ca A ⇄ B và Nhờ làm thay 2 ca/ngày nhận +30.000đ phụ cấp), xem Lương AI.
   - **Điểm danh Realtime:** Tự động quét GPS bán kính < 300m + Chụp ảnh xác nhận diện mạo bắt buộc mặc áo đồng phục màu hồng thương hiệu & đeo bảng tên nhân viên.

3. **Máy Chủ & Hàng Đợi (Backend Server - `apps/backend`):**
   - Node.js + Express + TypeScript + Socket.IO Realtime.
   - Cơ chế **Single-Writer Queue**: Xử lý toàn bộ ghi nhận chấm công, đổi ca vào Google Sheets chống xung đột dữ liệu 100%.
   - Zalo Bot Integration: Tự động sinh link Google Meet và bắn tin nhắn thư mời phỏng vấn từ Zalo cá nhân của HR.

---

## 🚀 CẤU TRÚC THƯ MỤC MONOREPO

```text
├── apps/
│   ├── admin-web/       # Cổng Quản Trị (Admin, HR, Store, Finance, MKT) - Vite + React + TS
│   ├── employee-web/    # Cổng Nhân Viên - Vite + React + TS (Mobile First)
│   └── backend/         # REST API & Socket.IO Server + Single-Writer Queue
├── packages/
│   └── shared/          # Kiểu dữ liệu TypeScript & Tiện ích dùng chung
├── 03_Trien_khai_Du_an_Cho_AI_Lap_trinh_UmBoMilk_V5_1_Giao_dien_Realtime.md
├── 05_Tong_hop_Tab_Chuc_nang_Tung_Tai_khoan_UmBoMilk_V5_1.md
├── logo.jpg
├── package.json
└── README.md
```

---

## 💻 HƯỚNG DẪN CÀI ĐẶT & CHẠY LOCAL

### 1. Yêu cầu môi trường
- **Node.js**: Phiên bản 18.x hoặc 20.x trở lên
- **npm**: Phiên bản 9.x hoặc 10.x trở lên

### 2. Cài đặt toàn bộ dependencies
```bash
npm install
```

### 3. Build toàn bộ dự án
```bash
npm run build
```

### 4. Khởi chạy các phân hệ
```bash
# Chạy Backend (Port 4005)
npm run dev:backend

# Chạy Admin Web (Port 3005)
npm run dev:admin

# Chạy Employee Web (Port 3006)
npm run dev:employee
```

---

## 🔑 TÀI KHOẢN TRUY CẬP MẶC ĐỊNH

### 1. Cổng Quản Trị Hệ Thống (`http://localhost:3005`):
- **Quản trị viên (Admin):** `admin` / `Master@@2027`
- **Nhân sự (HR):** `hr_lead` / `hr123`
- **Cửa hàng trưởng (Store 130):** `store_130` / `store123`
- **Kế toán lương (Finance):** `finance_lead` / `fin123`
- **Truyền thông (Marketing):** `mkt_lead` / `mkt123`

### 2. Cổng Nhân Viên (`http://localhost:3006`):
- **Nhân viên Thử việc:** `0901111222` (Nguyễn Văn An - CN130)
- **Nhân viên Chính thức:** `0903333444` (Trần Thị Bình - CN130)

---

## 🌐 HƯỚNG DẪN TRIỂN KHAI ONLINE (PRODUCTION)

Chi tiết quy trình triển khai online xem tại tài liệu dự án hoặc triển khai theo 2 phương thức:
1. **Cloud PaaS (Vercel + Render / Railway + Google Sheets Master)**: Miễn phí SSL HTTPS, tự động deploy khi push code.
2. **Máy chủ riêng (VPS Ubuntu + Nginx + PM2 + SSL Certbot Let's Encrypt)**: Dành cho vận hành máy chủ doanh nghiệp.

*Lưu ý: Bắt buộc cấu hình SSL HTTPS để điện thoại nhân viên có thể sử dụng Camera và Định vị GPS khi chấm công.*

---
© 2026 Ụm Bò Milk. All rights reserved.
