# Hình thức lương + Lương cơ bản & Phụ cấp theo khối (Beta — 2026-11)

> Tính năng Beta (`fin-salary-config`) — chip **BETA** ở sidebar cổng quản trị.
> Khi chốt chính thức: xóa dòng `'fin-salary-config'` trong `apps/admin-web/src/betaFeatures.tsx`.

## Quy tắc nghiệp vụ (chủ dự án chốt 2026-11)

- **HR** thêm hồ sơ **nhân viên mới** nhưng **KHÔNG được đặt lương** (kể cả phúc lợi).
- **Kế toán (FINANCE)** + **Admin** cấu hình **hình thức lương** + **lương cơ bản** + **phụ cấp** cho **từng NV**, phụ thuộc **khối làm việc**:

| Khối | `group` | Hình thức lương | Tùy chỉnh |
|---|---|---|---|
| Cửa Hàng | `STORE` | **Theo ca** (giờ × đơn giá) | Khóa cứng |
| Văn Phòng | `VAN_PHONG` | **Lương cơ bản theo THÁNG** | Khóa cứng |
| Xưởng SX | `XUONG` | Theo ca **hoặc** theo tháng | Kế toán chọn **từng NV** (mặc định theo ca) |
| Sales / MKT | `SALE` | Theo tháng **hoặc** theo ca | Kế toán chọn **từng NV** (mặc định theo tháng) |

- **Lương theo tháng** = Lương cơ bản + Phụ cấp.
- **Lương theo ca** = (giờ công × đơn giá) + Phụ cấp.
- Cấu hình là **hồ sơ gốc** cho kỳ lương:
  - NV **theo tháng**: kỳ lương tự lấy **LCB cấu hình** làm mặc định (`luong_cb`); kế toán vẫn nhập tay ghi đè được.
  - NV **theo ca**: giữ nguyên cách tính ca; phụ cấp cấu hình được cộng vào phiếu lương.
- **Phúc lợi VP cũ** (`office_benefits`, trước đây HR sửa ở tab Duyệt Văn Phòng) được **gộp một lần** vào phụ cấp và xóa khỏi UI; HR không còn quyền sửa lương/phúc lợi.

## Màn hình

| Vai trò | Tab | Quyền |
|---|---|---|
| HR | `20. Nhân viên (Theo Khối)` (tab `staff`) | Thêm NV mới + xem danh sách; cột Lương CB / Phụ cấp / Hình thức lương **chỉ xem** |
| FINANCE | `13. Cấu hình Lương CB & Phụ cấp (Theo Khối)` (tab `fin-salary-config`) | Chọn hình thức lương (Xưởng/Sale) + LCB + phụ cấp từng NV, lọc theo khối, lưu từng dòng hoặc "Lưu tất cả" |
| ADMIN | `2. Nhân sự` (`staff`) + `19. Cấu hình Lương CB & Phụ cấp (Theo Khối)` | Toàn quyền — đặt luôn lúc tạo NV (tuỳ chọn) và/hoặc cấu hình sau |
| DIRECTOR | `staff` | Chỉ xem cột LCB / phụ cấp / hình thức lương |

## API

| Endpoint | Quyền | Mô tả |
|---|---|---|
| `GET /salary-config` | DIRECTOR, ADMIN, HR, FINANCE | Trả map `{ employee_id: { pay_mode?, base_salary, allowance, updatedBy, updatedByName, updatedAt } }` |
| `PUT /salary-config/:employeeId` | FINANCE, ADMIN | Đặt hình thức + LCB + phụ cấp cho 1 NV (`{ payMode?: 'MONTHLY' \| 'HOURLY', baseSalary, allowance }`, ≥ 0). Server **bỏ qua** `payMode` với khối STORE / VAN_PHONG (ép theo khối) |
| `GET /office/timesheet` (cổng NV) | Nhân viên Văn Phòng | Trả `pay_mode: 'MONTHLY'`, `base_salary`, `allowance`, `monthly_total`, `work_days`, `total_hours` — **không còn** `rate_per_hour` / `estimated_pay` |

- `POST /employees` mở rộng: nhận `bankName/bank_name`, `bankAccount/bank_account`, `bankHolder/bank_holder`, `gender`, `birthDate`, `idCardNumber`, `email`, `startDate` và (riêng **ADMIN**) `baseSalary` + `allowance` — HR gửi lương lên server sẽ bị **bỏ qua**.
- Kỳ lương: `POST /payroll/:period/calculate` (draft & formula) dùng `pay_mode` hiệu lực; NV MONTHLY không cộng tiền theo ca, cộng LCB cấu hình + phụ cấp.

## Bền vững dữ liệu

- Cấu hình lương lưu trong **CÀI ĐẶT HỆ THỐNG** (`CAU_HINH_HE_THONG` trên Google Sheets), key `employee_salary_config`: `{ [employee_id]: { pay_mode?, base_salary, allowance, updatedBy, updatedByName, updatedAt } }` — **không đổi schema `NHAN_VIEN_MASTER`**.
- Migration một lần: `office_benefits` → `allowance` (chỉ điền khi NV chưa có phụ cấp; đánh dấu `office_benefits_merged_v1 = true`, xóa `office_benefits`).
- Ghi tuần tự qua mutex trong process; restart không mất dữ liệu (đồng bộ Sheets).
- Append `NHAN_VIEN_MASTER` khi tạo NV mới đã mở rộng ghi đủ cột 13–19 (gender, ngày sinh, CCCD, ngân hàng/STK/chủ TK).
- Tab `PHIEU_LUONG` thêm cột 40 **"Phụ Cấp (cấu hình)"** (không tái sử dụng cột OT cũ để tránh dữ liệu legacy); khi đọc lại Sheets, phiếu chưa chốt tự tính tổng = LCB + phụ cấp + lương giờ + OT + bonus.

## Frontend

- `packages/shared/src/payMode.ts` — helper dùng chung: `effectivePayMode(group, configured)`, `isPayModeLockedToGroup`, `defaultPayModeForGroup`, `payModeLabel`.
- `components/SalaryConfigView.tsx` — màn hình Kế toán: thẻ tóm tắt 4 khối, tìm kiếm, bảng nhóm theo khối, cột **Hình thức lương** (chip khóa cho Cửa hàng/Văn phòng; dropdown cho Xưởng/Sale), LCB chỉ nhập khi theo tháng, phụ cấp mọi hình thức, realtime reload.
- Tab Nhân sự (`staff`): chip lọc **Khối**, cột **Lương CB**, **Phụ cấp**, **Hình thức lương** (chỉ xem).
- Cổng NV Văn Phòng → **Công của tôi**: hiển thị **Lương cơ bản (tháng) + Phụ cấp**, ngày công/tổng giờ chỉ để theo dõi, không tính tiền theo ca.
- Tab **Duyệt Văn Phòng** đã bỏ mục "Lương & Phúc lợi VP" (HR không còn quyền sửa lương).

## Lưu ý

- Phiếu lương in có thêm dòng **Phụ cấp** và hiển thị **Hình thức** (Theo ca / Theo tháng).
- Chưa tự động chốt kỳ lương: kế toán vẫn bấm tính lương và có thể sửa tay từng NV.
