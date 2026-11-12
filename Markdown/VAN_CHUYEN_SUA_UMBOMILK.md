# PROMPT ĐẶC TẢ XÂY DỰNG HỆ THỐNG QUẢN LÝ LỘ TRÌNH VẬN CHUYỂN SỮA & ĐỘI XE ĐIỆN (MILKROUTE EV)

> **Hướng dẫn sử dụng:** Bạn có thể copy toàn bộ nội dung bên dưới để gửi cho Đội ngũ Lập trình (Dev Team / BA) làm tài liệu yêu cầu kỹ thuật (SRS), hoặc dán trực tiếp vào AI Coding (Cursor, Windsurf, v0, Claude, ChatGPT...) để sinh mã nguồn Full-stack / Prototype.

---

## 1. BỐI CẢNH & VAI TRÒ (ROLE & OBJECTIVE)
Hãy đóng vai một **Kiến trúc sư Phần mềm (Solution Architect)** và **Lập trình viên Full-stack Senior**. Nhiệm vụ của bạn là thiết kế và xây dựng hệ thống **Phần mềm Quản lý Lộ trình Vận chuyển Sữa bằng Xe Điện theo thời gian thực (Realtime GPS Tracking & EV Fleet Management)** cho thương hiệu **Ụm Bò Milk** tại TP. Hồ Chí Minh.

Hệ thống bao gồm 2 phân hệ đồng bộ dữ liệu theo thời gian thực (Realtime):
1. **Mobile App dành cho Nhân viên giao hàng (Tài xế xe điện):** Chạy trên iOS/Android (hoặc PWA Mobile), lấy định vị GPS thực tế, xác nhận điểm giao hàng trong bán kính 100m, tạo phiếu xin sạc xe điện và cập nhật trạng thái sạc.
2. **Web App dành cho Admin / Nhân sự (HR) / Giám đốc:** Giám sát lộ trình xe chạy trực tiếp trên bản đồ Google Maps (GMAP), theo dõi giới hạn thời gian từng chặng (SLA), phê duyệt phiếu sạc xe 2 cấp, giám sát thời gian sạc xe realtime và tự động tính lương/khấu trừ tiền phạt cuối ca.

---

## 2. DỮ LIỆU LỘ TRÌNH CỐ ĐỊNH & TỌA ĐỘ GPS THỰC TẾ
Nhân viên vận chuyển sữa theo lộ trình khép kín cố định trong ngày:
**Xưởng Sản Xuất &rarr; CH130 &rarr; CH111 &rarr; CH261 &rarr; Trụ Sở Chính &rarr; (Trạm Sạc Xe Điện nếu có phiếu duyệt) &rarr; Xưởng Sản Xuất.**

### Danh sách tọa độ GPS chính xác của các điểm:
1. **Điểm xuất phát & Kết thúc ca – Xưởng Sản Xuất Ụm Bò Milk:**
   - **Địa chỉ:** 85/14 Bùi Công Trừng, Hóc Môn / Q.12, TP. Hồ Chí Minh
   - **Tọa độ GPS:** `10°54'28.9"N 106°39'01.6"E` (Hệ thập phân: `10.908028, 106.650444`)
2. **Điểm giao hàng 1 – Cửa hàng CH130:**
   - **Địa chỉ:** 130 Vạn Kiếp, Phường 3, Quận Bình Thạnh, TP. Hồ Chí Minh
   - **Tọa độ GPS:** `10.799831, 106.693370`
3. **Điểm giao hàng 2 – Cửa hàng CH111:**
   - **Địa chỉ:** 111 Tôn Đản, Phường 15, Quận 4, TP. Hồ Chí Minh
   - **Tọa độ GPS:** `10.759223, 106.706995`
4. **Điểm giao hàng 3 – Cửa hàng CH261:**
   - **Địa chỉ:** 261 Tô Hiến Thành, Phường 12, Quận 10, TP. Hồ Chí Minh
   - **Tọa độ GPS:** `10.778639, 106.666665`
5. **Điểm giao hàng 4 – Trụ sở chính (Văn phòng):**
   - **Địa chỉ:** Số 10 Đặng Thai Mai, Phường Phú Nhuận, TP. Hồ Chí Minh
   - **Tọa độ GPS:** `10.803040, 106.689620`

---

## 3. ĐỊNH MỨC THỜI GIAN DI CHUYỂN TỪNG CHẶNG (SLA)
Hệ thống bắt buộc bấm giờ tự động ngay khi nhân viên hoàn thành điểm trước đó để tính thời gian di chuyển đến điểm tiếp theo. Nếu vượt quá thời gian giới hạn dưới đây, hệ thống sẽ đánh dấu **"Vi phạm SLA (Đi trễ giờ)"**:

| Thứ tự chặng | Điểm đi &rarr; Điểm đến | Giới hạn thời gian tối đa (SLA) |
| :--- | :--- | :--- |
| **Chặng 1** | Xưởng Sản Xuất &rarr; CH130 (Vạn Kiếp) | **60 phút (1 tiếng)** |
| **Chặng 2** | CH130 (Vạn Kiếp) &rarr; CH111 (Tôn Đản) | **45 phút** |
| **Chặng 3** | CH111 (Tôn Đản) &rarr; CH261 (Tô Hiến Thành) | **45 phút** |
| **Chặng 4** | CH261 (Tô Hiến Thành) &rarr; Trụ sở chính (Đặng Thai Mai) | **45 phút** |
| **Chặng 5 (Nhánh sạc xe)** | Trụ sở chính &rarr; Trạm sạc xe điện bất kỳ | **60 phút (1 tiếng)** |
| **Chặng 6 (Về xưởng)** | Trạm sạc xe điện (hoặc Trụ sở chính) &rarr; Xưởng Sản Xuất | **15 phút** |

---

## 4. LUỒNG NGHIỆP VỤ CHI TIẾT (CORE WORKFLOWS)

### 4.1. Luồng Giao Nhận & Kiểm Soát Geofencing 100m
1. **Bắt đầu ca tại Xưởng:**
   - Nhân viên đứng tại Xưởng Sản Xuất (`10.908028, 106.650444`), bấm nút **"BẮT ĐẦU"**.
   - **Điều kiện bắt buộc:** Thiết bị phải đang bật định vị GPS (`navigator.geolocation`) và khoảng cách đến tâm tọa độ Xưởng $\le 100\text{m}$. Nếu tắt GPS hoặc đứng ngoài phạm vi $100\text{m}$, hệ thống chặn thao tác và hiển thị cảnh báo.
2. **Giám sát đường đi thực tế (Realtime Tracking):**
   - Trong suốt quá trình di chuyển, App nhân viên gửi tọa độ GPS theo thời gian thực về Web Admin.
   - Trên Web Admin hiển thị bản đồ Google Maps đường phố thực tế, vẽ rõ **vệt đường nhân viên đã đi**, vận tốc hiện tại, tổng số km đã đi và đồng hồ đếm thời gian SLA của chặng hiện tại.
3. **Xác nhận tại từng điểm (CH130, CH111, CH261, Trụ sở chính):**
   - Sử dụng công thức toán học **Haversine** để tính khoảng cách từ vị trí GPS thực tế của nhân viên đến tọa độ từng cửa hàng.
   - Khi nhân viên tiến vào **phạm vi bán kính $\le 100\text{m}$** của cửa hàng, nút **"XÁC NHẬN CỬA HÀNG"** trên App sẽ mở khóa.
   - Nhân viên bấm xác nhận &rarr; Hệ thống ghi nhận thời gian đến, đối chiếu với giới hạn thời gian SLA của chặng đó và cập nhật tức thì lên Web Admin.
   - Nếu nhân viên đi qua cửa hàng mà quên hoặc cố tình không bấm xác nhận &rarr; Hệ thống ghi nhận lỗi **"Thiếu xác nhận điểm đến"** và trừ tiền phạt trực tiếp vào ngày công hôm đó.

### 4.2. Luồng Xin Phép & Giám Sát Sạc Xe Điện (EV Charging Workflow)
1. **Tạo Phiếu Xin Sạc Xe Điện (Không cố định trạm sạc trước):**
   - Trên App Nhân viên có tab **"Phiếu Sạc Xe Điện"**.
   - Nhân viên tạo phiếu chỉ cần **chọn Ngày sạc xe** (và ghi chú mức pin hiện tại nếu cần), **KHÔNG cần chọn trước địa điểm trạm sạc** để đảm bảo tính linh hoạt trên đường.
2. **Quy trình Phê duyệt 2 cấp (Sequential Approval):**
   - Khi nhân viên bấm gửi phiếu, trạng thái phiếu là `PENDING_HR` (Chờ Nhân sự duyệt).
   - **Cấp 1 (Nhân sự - HR):** Kiểm tra và bấm duyệt &rarr; Trạng thái chuyển sang `PENDING_DIRECTOR` (Chờ Giám đốc duyệt).
   - **Cấp 2 (Giám đốc - Director):** Bấm duyệt &rarr; Trạng thái chuyển sang `APPROVED` và trả phiếu về App Nhân viên.
   - **Hiệu lực của phiếu:** Phiếu chỉ có hiệu lực sau khi Giám đốc đã duyệt và **chỉ có giá trị sử dụng nội trong ngày sạc đã đăng ký**.
3. **Bắt đầu sạc & Tự động ghim tọa độ trạm sạc:**
   - Sau khi hoàn thành giao hàng tại Văn phòng, nhân viên di chuyển đến một trạm sạc bất kỳ (giới hạn thời gian di chuyển từ Văn phòng đến trạm sạc tối đa **60 phút**).
   - Khi đến nơi sạc, nhân viên bấm nút **"XÁC NHẬN BẮT ĐẦU SẠC"** trên App.
   - Ngay khoảnh khắc bấm nút, hệ thống lấy **tọa độ GPS thực tế của xe tại thời điểm đó** gửi về Web Admin, hiển thị điểm sạc lên bản đồ GMAP và bắt đầu chạy **Đồng hồ đếm thời gian sạc Realtime** (ghi rõ giờ bắt đầu sạc).
4. **Hoàn tất sạc & Về thẳng Xưởng:**
   - Khi xe đầy pin, nhân viên bấm nút **"ĐÃ SẠC XONG"** trên giao diện App.
   - Hệ thống lập tức chốt **Thời gian kết thúc sạc** và **Tổng thời gian sạc** lên Web Admin.
   - Từ vị trí trạm sạc đó, lộ trình tự động chuyển sang chặng cuối: **Đi thẳng từ Trạm sạc về Xưởng Sản Xuất** (giới hạn thời gian **15 phút**) để bấm **"KẾT THÚC CA"**.

---

## 5. CƠ CẤU QUỸ LƯƠNG & QUY TẮC TÍNH PHẠT TỰ ĐỘNG

### 5.1. Quy định Quỹ lương tháng (`6.500.000đ / 30 ngày`)
Tổng mức lương `6.500.000đ` được tách thành 2 quỹ ngày công riêng biệt:
1. **Quỹ 28 ngày công chuẩn đầu tiên (`6.000.000đ / 28 ngày`):**
   $$\text{Đơn giá 1 ngày công chuẩn} = \frac{6.000.000\text{đ}}{28\text{ ngày}} = \mathbf{214.286\text{đ / ngày công}}$$
2. **Quỹ 2 ngày công còn lại - Ngày thứ 29 và 30 (`500.000đ / 2 ngày`):**
   $$\text{Đơn giá 1 ngày công (2 ngày cuối)} = \frac{500.000\text{đ}}{2\text{ ngày}} = \mathbf{250.000\text{đ / ngày công}}$$

### 5.2. Công thức tính tiền phạt trong ngày công
Trong 1 ngày làm việc, nhân viên có **4 điểm bắt buộc phải bấm xác nhận** trên lộ trình (`CH130`, `CH111`, `CH261`, `Trụ sở chính`). Mỗi điểm tương ứng **25% giá trị ngày công** hôm đó:

- **Đối với nhóm 28 ngày công chuẩn (`214.286đ/ngày`):**
  - **Phạt thiếu xác nhận 1 điểm (25% công):** $-53.571\text{đ / điểm}$ *(Thiếu 2 điểm trừ $107.143\text{đ}$; Thiếu 3 điểm trừ $160.714\text{đ}$; Thiếu cả 4 điểm trừ $214.286\text{đ} \rightarrow$ thực nhận $0\text{đ}$)*.
  - **Phạt đi trễ giới hạn thời gian SLA 1 chặng (10% công):** $-21.429\text{đ / chặng trễ}$.
- **Đối với nhóm 2 ngày công còn lại (`250.000đ/ngày`):**
  - **Phạt thiếu xác nhận 1 điểm (25% công):** $-62.500\text{đ / điểm}$ *(Thiếu 2 điểm trừ $125.000\text{đ}$; Thiếu 3 điểm trừ $187.500\text{đ}$; Thiếu cả 4 điểm trừ $250.000\text{đ} \rightarrow$ thực nhận $0\text{đ}$)*.
  - **Phạt đi trễ giới hạn thời gian SLA 1 chặng (10% công):** $-25.000\text{đ / chặng trễ}$.

> **Quy tắc chốt ca:** Khi nhân viên quay về Xưởng Sản Xuất và bấm **"KẾT THÚC CA"**, hệ thống tự động đối soát toàn bộ điểm dừng + thời gian SLA từng chặng và xuất bảng quyết toán tiền công thực nhận của ngày hôm đó.

---

## 6. YÊU CẦU KỸ THUẬT & GIAO DIỆN (TECHNICAL REQUIREMENTS)
1. **Bản đồ & Định tuyến:**
   - Sử dụng Leaflet.js kết hợp lớp bản đồ đường phố Google Maps (`mt1.google.com/vt/lyrs=m`) và OSRM Routing API để vẽ đường đi thực tế bám theo từng con đường tại TP.HCM.
   - Hiển thị rõ vòng tròn bán kính $100\text{m}$ (Geofence Circle) xung quanh các cửa hàng và Xưởng.
2. **Xử lý GPS:**
   - Hỗ trợ cả 2 chế độ: **Lấy GPS phần cứng thật từ thiết bị** (`navigator.geolocation.watchPosition`) và **Chế độ giả lập chạy xe trên đường phố thực tế** (để kiểm thử toàn bộ quy trình).
3. **Giao diện (UI/UX):**
   - Thiết kế hiện đại bằng Tailwind CSS, chia rõ khu vực điều khiển của **App Nhân Viên (khung điện thoại)** và **Web Admin + Cổng phê duyệt Nhân sự / Giám đốc** để dễ dàng thao tác và kiểm thử luồng dữ liệu Realtime.