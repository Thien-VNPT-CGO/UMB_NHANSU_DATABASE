**ỤM BÒ MILK**

**TỔNG HỢP TAB & CHỨC NĂNG  
THEO TỪNG TÀI KHOẢN**

**WEB APP SOCKET QUẢN TRỊ + WEB APP SOCKET NHÂN VIÊN**

| **Phiên bản**     | V5.1 - Tổng hợp chức năng            |
|-------------------|--------------------------------------|
| **Ngày cập nhật** | 23/09/2026                           |
| **Kiến trúc**     | 02 Web App / 07 loại tài khoản       |
| **Data chính**    | Google Sheets; ảnh/tệp: Google Drive |

# **1. Cấu trúc tổng thể**

**Hệ thống có 02 Web App chính, không xây riêng 07 ứng dụng.**

- Web App Socket Quản trị nội bộ: dùng chung cho Admin, HR, Store, Finance và MKT. Sau đăng nhập, backend trả ROLE + branchScope + permissions để quyết định tab và dữ liệu được hiển thị.

- Web App Socket Nhân viên: dùng chung cho Nhân viên Thử việc và Nhân viên Chính thức. Sau khi nhập SĐT, backend kiểm tra Google Sheets và chỉ cho đăng nhập khi tài khoản đã được Admin kích hoạt ACTIVE.

- Google Sheets là nguồn dữ liệu nghiệp vụ có cấu trúc chính. Google Drive lưu ảnh/tệp. Socket.IO dùng để cập nhật và thông báo realtime, không phải nơi lưu dữ liệu.

## **Tóm tắt số tab theo tài khoản**

| **Tài khoản**            | **Số tab** | **Phạm vi chính**                                |
|--------------------------|------------|--------------------------------------------------|
| **Admin**                | **12**     | Quản trị hệ thống, tài khoản, cấu hình, tích hợp |
| **HR**                   | **15**     | Tuyển dụng, nhân sự, lịch, OFF, công, TEST       |
| **Store**                | **10**     | Vận hành nhân sự tại chi nhánh                   |
| **Finance**              | **11**     | Công, đối soát, tính lương, phiếu lương          |
| **MKT**                  | **9**      | Truyền thông nội bộ                              |
| **Nhân viên Thử việc**   | **9**      | Lịch thử việc, điểm danh, OFF, TEST, công        |
| **Nhân viên Chính thức** | **9**      | Lịch tuần, điểm danh, OFF, đổi ca, công, lương   |

# **2. TÀI KHOẢN ADMIN**

Quản trị hệ thống, quyền truy cập và cấu hình toàn hệ thống.

| **12 TAB** | Admin có thể quan sát toàn hệ thống nhưng không mặc định thay HR/Finance thực hiện hoặc duyệt nghiệp vụ chuyên môn. |
|------------|---------------------------------------------------------------------------------------------------------------------|

<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>#</strong></th>
<th><strong>TAB / MÀN HÌNH</strong></th>
<th><strong>CHỨC NĂNG CỤ THỂ</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>1</strong></td>
<td><strong>Dashboard</strong></td>
<td><ul>
<li><p>Tổng quan toàn hệ thống: tổng nhân sự, nhân viên mới, thử việc, chính thức, đang có mặt, vắng mặt và nhân viên chờ kích hoạt.</p></li>
<li><p>Hiển thị tình trạng nhân sự theo từng chi nhánh và ca đang diễn ra/ca sắp tới.</p></li>
<li><p>Hiển thị số phiếu hoặc sự kiện cần xử lý: kích hoạt tài khoản, lỗi đồng bộ, cảnh báo hệ thống.</p></li>
<li><p>Theo dõi trạng thái Google Sheets, Google Drive, Socket.IO và các dịch vụ tích hợp.</p></li>
<li><p>Cho phép lọc dữ liệu theo chi nhánh, trạng thái và khoảng thời gian.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>2</strong></td>
<td><strong>Tài khoản &amp; Phân quyền</strong></td>
<td><ul>
<li><p>Tạo, sửa, khóa/mở khóa tài khoản nội bộ.</p></li>
<li><p>Gán vai trò Admin, HR, Store, Finance, MKT và các permission bổ sung nếu được phê duyệt.</p></li>
<li><p>Gán branchScope: ALL hoặc một/nhiều chi nhánh được phép thao tác.</p></li>
<li><p>Xem trạng thái tài khoản, lần đăng nhập gần nhất và lịch sử thay đổi quyền.</p></li>
<li><p>Không lưu mật khẩu/PIN thô trong Google Sheets.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>3</strong></td>
<td><strong>Kích hoạt tài khoản Nhân viên</strong></td>
<td><ul>
<li><p>Danh sách nhân viên thử việc/chính thức đang ở trạng thái PENDING_ACTIVATION.</p></li>
<li><p>Tìm theo mã nhân viên, họ tên hoặc SĐT chuẩn hóa.</p></li>
<li><p>Nút KÍCH HOẠT cập nhật trạng thái ACTIVE trên Google Sheets; chỉ báo thành công sau khi ghi được xác nhận.</p></li>
<li><p>Khóa/thu hồi tài khoản; khi thu hồi phải làm mất hiệu lực phiên và phát Socket forceLogout.</p></li>
<li><p>Xem activated_by, activated_at, revoked_at và audit liên quan.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>4</strong></td>
<td><strong>Quản lý Nhân viên</strong></td>
<td><ul>
<li><p>Xem nhân viên mới, thử việc, chính thức, xưởng, văn phòng và sale.</p></li>
<li><p>Lọc theo chi nhánh, nhóm nhân sự, giai đoạn và trạng thái tài khoản.</p></li>
<li><p>Xem hồ sơ, mã NV, lịch sử giai đoạn, lịch sử chi nhánh/ca và trạng thái TEST.</p></li>
<li><p>Admin chủ yếu quản trị và quan sát; nghiệp vụ tuyển dụng/chuyển chính thức do HR thực hiện.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>5</strong></td>
<td><strong>Chi nhánh &amp; Ca làm</strong></td>
<td><ul>
<li><p>Quản lý 4 chi nhánh và thông tin cấu hình.</p></li>
<li><p>Tọa độ GPS, bán kính điểm danh, timezone và trạng thái hoạt động.</p></li>
<li><p>Quản lý mẫu ca Sáng/Chiều/Tối, giờ bắt đầu/kết thúc và ngày hiệu lực.</p></li>
<li><p>Cấu hình định biên tối thiểu/tối đa theo chi nhánh và ca nếu đã được doanh nghiệp chốt.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>6</strong></td>
<td><strong>Chính sách hệ thống</strong></td>
<td><ul>
<li><p>Cấu hình cửa thời gian điểm danh, bán kính GPS, quy tắc OFF, TEST và tham số nghiệp vụ được phép cấu hình.</p></li>
<li><p>Mỗi chính sách có phiên bản, ngày hiệu lực và người phê duyệt.</p></li>
<li><p>Không tự thay đổi các chính sách lương/phạt/OT nếu chưa được chủ dự án phê duyệt.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>7</strong></td>
<td><strong>Thông báo hệ thống</strong></td>
<td><ul>
<li><p>Notification Center theo thời gian thực.</p></li>
<li><p>Nhận sự kiện kích hoạt tài khoản, lỗi đồng bộ, lỗi chấm công, thiếu ca và cảnh báo hệ thống.</p></li>
<li><p>Badge số lượng chưa đọc; đánh dấu đã đọc/chưa đọc; đi trực tiếp đến bản ghi cần xử lý.</p></li>
<li><p>Thông báo quan trọng phải có lịch sử, không chỉ phụ thuộc Socket.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>8</strong></td>
<td><strong>Tích hợp &amp; Đồng bộ</strong></td>
<td><ul>
<li><p>Theo dõi trạng thái Google Sheets API, Google Drive, Socket.IO và các Bot/API được cấp quyền.</p></li>
<li><p>Hiển thị hàng đợi ghi dữ liệu, retry, lỗi quota/timeout và trạng thái NEEDS_RECONCILIATION.</p></li>
<li><p>Cho phép kiểm tra sức khỏe tích hợp mà không làm thay đổi dữ liệu nghiệp vụ.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>9</strong></td>
<td><strong>Bảo trì hệ thống</strong></td>
<td><ul>
<li><p>Bật/tắt bảo trì toàn hệ thống hoặc từng module.</p></li>
<li><p>Bảo trì riêng Web App Nhân viên hoặc một nhóm chức năng.</p></li>
<li><p>Hiển thị thông báo bảo trì thân thiện và thời gian dự kiến nếu có.</p></li>
<li><p>Không dùng bảo trì để che lỗi dữ liệu hoặc bỏ qua quy trình đối soát.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>10</strong></td>
<td><strong>Audit Log</strong></td>
<td><ul>
<li><p>Xem actor, action, entity, dữ liệu trước/sau, timestamp và thông tin truy vết.</p></li>
<li><p>Lọc theo tài khoản, module, thời gian và loại sự kiện.</p></li>
<li><p>Theo dõi lịch sử kích hoạt/khóa tài khoản, cấu hình, lịch, công và các hành động quản trị.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>11</strong></td>
<td><strong>Backup &amp; Recovery</strong></td>
<td><ul>
<li><p>Theo dõi snapshot/backup Google Sheets và Google Drive.</p></li>
<li><p>Xem lịch sử backup, trạng thái thành công/thất bại và lỗi.</p></li>
<li><p>Khôi phục chỉ theo quy trình được phê duyệt; ưu tiên thử trên môi trường non-production.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>12</strong></td>
<td><strong>Cài đặt hệ thống</strong></td>
<td><ul>
<li><p>Cấu hình tên hệ thống, logo, timezone, định dạng ngày giờ và các tham số giao diện chung.</p></li>
<li><p>Cấu hình timeout phiên, mức log và các tùy chọn kỹ thuật an toàn được phép chỉnh.</p></li>
<li><p>Không chứa secrets/API token trên giao diện hoặc Google Sheets.</p></li>
</ul></td>
</tr>
</tbody>
</table>

# **3. TÀI KHOẢN HR**

Quản lý vòng đời nhân sự từ ứng viên đến chính thức.

| **15 TAB** | HR chịu trách nhiệm nghiệp vụ tuyển dụng, thử việc, lịch, OFF, đổi ca, chấm công và TEST; Admin là bên kích hoạt tài khoản nhân viên theo quyết định hiện tại. |
|------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|

<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>#</strong></th>
<th><strong>TAB / MÀN HÌNH</strong></th>
<th><strong>CHỨC NĂNG CỤ THỂ</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>1</strong></td>
<td><strong>Dashboard HR</strong></td>
<td><ul>
<li><p>Tổng nhân sự, ứng viên mới, lịch phỏng vấn hôm nay, NV thử việc, NV sắp hết thử việc.</p></li>
<li><p>Hiển thị nghỉ hôm nay, thiếu ca, chấm công bất thường và các phiếu cần xử lý.</p></li>
<li><p>Ưu tiên danh sách hành động cần làm thay vì chỉ hiển thị biểu đồ.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>2</strong></td>
<td><strong>Ứng viên mới</strong></td>
<td><ul>
<li><p>Nhận dữ liệu từ Google Form/FROM_NHAN_VIEN.</p></li>
<li><p>Xem hồ sơ, tìm kiếm, lọc, ghi chú HR và trạng thái xử lý.</p></li>
<li><p>Mở kênh liên hệ đã được tích hợp; không tự loại theo tiêu chí không liên quan công việc.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>3</strong></td>
<td><strong>Phỏng vấn</strong></td>
<td><ul>
<li><p>Tạo lịch phỏng vấn 30 phút, kiểm tra trùng lịch và thời gian hợp lệ.</p></li>
<li><p>Tạo Google Meet/Calendar khi quyền tích hợp thật đã hoạt động.</p></li>
<li><p>Theo dõi xác nhận, trạng thái cần đổi lịch, chấm điểm/nhận xét và quyết định của HR.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>4</strong></td>
<td><strong>Nhân viên Thử việc</strong></td>
<td><ul>
<li><p>Quản lý mã NV, SĐT, chi nhánh, ca, ngày bắt đầu/kết thúc và số ngày thử việc.</p></li>
<li><p>Xem trạng thái tài khoản, lịch thử việc, kết quả TEST và các yêu cầu liên quan.</p></li>
<li><p>Tạo/đề xuất hồ sơ tài khoản ở trạng thái chờ Admin kích hoạt.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>5</strong></td>
<td><strong>Nhân viên Chính thức</strong></td>
<td><ul>
<li><p>Quản lý hồ sơ, chi nhánh, ca, ngày chính thức và trạng thái nhân sự.</p></li>
<li><p>Xem lịch sử giai đoạn, lịch làm việc, TEST và các thay đổi có hiệu lực.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>6</strong></td>
<td><strong>Chuyển Chính thức</strong></td>
<td><ul>
<li><p>Xem đánh giá, công thử việc, TEST và điều kiện nội bộ đã được phê duyệt.</p></li>
<li><p>HR thực hiện quyết định chuyển chính thức và ghi effective_from.</p></li>
<li><p>Không xóa lịch sử thử việc; employee_id giữ nguyên.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>7</strong></td>
<td><strong>Lịch làm việc</strong></td>
<td><ul>
<li><p>Tạo/xem lịch theo tuần, chi nhánh và ca.</p></li>
<li><p>Kiểm tra định biên, xung đột và trạng thái DRAFT/PUBLISHED.</p></li>
<li><p>Duyệt/phát lịch theo quyền; lịch chỉ có hiệu lực với nhân viên sau khi PUBLISHED.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>8</strong></td>
<td><strong>Nghỉ OFF</strong></td>
<td><ul>
<li><p>Xem OFF thử việc và OFF hàng tuần của chính thức.</p></li>
<li><p>Kiểm tra định biên sau khi nghỉ; duyệt/từ chối và ghi lý do.</p></li>
<li><p>Theo dõi trạng thái phiếu và audit thay đổi.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>9</strong></td>
<td><strong>Đổi ca</strong></td>
<td><ul>
<li><p>Theo dõi yêu cầu NV A -&gt; NV B xác nhận -&gt; HR/Store duyệt.</p></li>
<li><p>Xem ca cũ, ca mới, người thay, lý do và tình trạng xử lý.</p></li>
<li><p>Chỉ cập nhật lịch chính thức khi quy trình duyệt hoàn tất.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>10</strong></td>
<td><strong>Nghỉ đột xuất</strong></td>
<td><ul>
<li><p>Nhận yêu cầu nghỉ khẩn; ghi nhận lý do.</p></li>
<li><p>Theo dõi tìm người thay và tình trạng thiếu ca.</p></li>
<li><p>Không tự đồng nhất “không tìm được người thay” với việc nhân viên bắt buộc phải đi làm; phải escalated để xử lý.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>11</strong></td>
<td><strong>Chấm công</strong></td>
<td><ul>
<li><p>Xem check-in/check-out, giờ thực tế, đi trễ, về sớm và trạng thái bất thường.</p></li>
<li><p>Ảnh/GPS chỉ hiển thị theo quyền và scope phù hợp.</p></li>
<li><p>Cho phép mở hồ sơ ca để đối chiếu dữ liệu gốc.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>12</strong></td>
<td><strong>Bổ sung / Điều chỉnh công</strong></td>
<td><ul>
<li><p>Nhận yêu cầu quên check-in/out, lỗi GPS/camera hoặc sự cố hợp lệ.</p></li>
<li><p>Kiểm tra bằng chứng, duyệt/từ chối và ghi lý do.</p></li>
<li><p>Không sửa/xóa event chấm công gốc; tạo adjustment có audit.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>13</strong></td>
<td><strong>TEST nhân viên</strong></td>
<td><ul>
<li><p>Giao lịch TEST, theo dõi trạng thái làm bài và kết quả.</p></li>
<li><p>Xem điểm, thời gian làm, thi lại và lịch sử thi.</p></li>
<li><p>Ngân hàng câu hỏi và ngưỡng đạt chỉ bật khi đã được xác minh/phê duyệt.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>14</strong></td>
<td><strong>Báo cáo HR</strong></td>
<td><ul>
<li><p>Headcount, thử việc/chính thức, tuyển dụng, thiếu ca, đi trễ, vắng mặt và các chỉ số HR có đủ dữ liệu.</p></li>
<li><p>Lọc theo chi nhánh, thời gian và nhóm nhân sự.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>15</strong></td>
<td><strong>Thông báo HR</strong></td>
<td><ul>
<li><p>Lịch phỏng vấn, nhân viên chờ xử lý, OFF, đổi ca, TEST, lỗi chấm công và các sự kiện HR.</p></li>
<li><p>Có badge và deep-link đến hồ sơ/phiếu tương ứng.</p></li>
</ul></td>
</tr>
</tbody>
</table>

# **4. TÀI KHOẢN STORE**

Quản lý vận hành nhân sự tại chi nhánh.

| **10 TAB** | Store chỉ xem và thao tác trong branchScope được phân công; không được truy cập chi nhánh khác hoặc dữ liệu lương toàn công ty. |
|------------|---------------------------------------------------------------------------------------------------------------------------------|

<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>#</strong></th>
<th><strong>TAB / MÀN HÌNH</strong></th>
<th><strong>CHỨC NĂNG CỤ THỂ</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>1</strong></td>
<td><strong>Dashboard Store</strong></td>
<td><ul>
<li><p>Số nhân viên thuộc chi nhánh, ai đang có mặt, ai chưa check-in và ca hiện tại/ca tiếp theo.</p></li>
<li><p>Hiển thị nghỉ hôm nay, thiếu người và cảnh báo vận hành theo chi nhánh.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>2</strong></td>
<td><strong>Nhân viên chi nhánh</strong></td>
<td><ul>
<li><p>Danh sách nhân viên thuộc branchScope của Store.</p></li>
<li><p>Xem trạng thái nhân sự, ca, thông tin vận hành cần thiết.</p></li>
<li><p>Không xem dữ liệu chi nhánh khác.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>3</strong></td>
<td><strong>Lịch làm việc</strong></td>
<td><ul>
<li><p>Xem lịch tuần của chi nhánh.</p></li>
<li><p>Kiểm tra đủ/thiếu nhân sự từng ca; đề xuất điều chỉnh.</p></li>
<li><p>Xác nhận dữ liệu vận hành trước khi HR phát lịch nếu quy trình yêu cầu.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>4</strong></td>
<td><strong>OFF hàng tuần</strong></td>
<td><ul>
<li><p>Xem yêu cầu nghỉ của nhân viên chi nhánh.</p></li>
<li><p>Kiểm tra định biên và xung đột.</p></li>
<li><p>Duyệt/xác nhận theo permission được Admin/HR cấp.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>5</strong></td>
<td><strong>Đổi ca</strong></td>
<td><ul>
<li><p>Xem yêu cầu đổi ca trong chi nhánh.</p></li>
<li><p>Kiểm tra người thay, thời gian chồng ca và định biên.</p></li>
<li><p>Duyệt/xác nhận theo branchScope.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>6</strong></td>
<td><strong>Nghỉ đột xuất</strong></td>
<td><ul>
<li><p>Nhận cảnh báo nghỉ khẩn.</p></li>
<li><p>Tìm/xác nhận người thay; báo HR khi không tìm được người thay.</p></li>
<li><p>Theo dõi trạng thái ca sau khi xử lý.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>7</strong></td>
<td><strong>Chấm công realtime</strong></td>
<td><ul>
<li><p>Xem nhân viên đã/chưa check-in, check-out, đi trễ và bất thường.</p></li>
<li><p>Ảnh/GPS theo quyền và chỉ trong chi nhánh phụ trách.</p></li>
<li><p>Nhận cảnh báo realtime từ Socket khi có sự kiện cần quản lý xử lý.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>8</strong></td>
<td><strong>Xác nhận công</strong></td>
<td><ul>
<li><p>Đối chiếu công thực tế của nhân viên chi nhánh.</p></li>
<li><p>Xác nhận sự cố, ghi chú và chuyển dữ liệu đủ điều kiện sang HR/Finance.</p></li>
<li><p>Không tự thay đổi event chấm công gốc.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>9</strong></td>
<td><strong>Báo cáo chi nhánh</strong></td>
<td><ul>
<li><p>Ngày công, giờ làm, trễ, vắng, ca thiếu người, tỷ lệ phủ ca và nhân sự hiện tại.</p></li>
<li><p>Lọc theo tuần/tháng và ca.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>10</strong></td>
<td><strong>Thông báo Store</strong></td>
<td><ul>
<li><p>NV chưa điểm danh, thiếu người, đổi ca, nghỉ đột xuất, lỗi điểm danh và lịch tuần mới.</p></li>
<li><p>Thông báo chỉ trong branchScope được cấp.</p></li>
</ul></td>
</tr>
</tbody>
</table>

# **5. TÀI KHOẢN FINANCE**

Đối soát công, tính lương và phát phiếu lương.

| **11 TAB** | Finance làm việc trên dữ liệu công đã được xác nhận; người lập bảng lương không mặc định tự duyệt chính bảng lương mình tạo. |
|------------|------------------------------------------------------------------------------------------------------------------------------|

<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>#</strong></th>
<th><strong>TAB / MÀN HÌNH</strong></th>
<th><strong>CHỨC NĂNG CỤ THỂ</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>1</strong></td>
<td><strong>Dashboard Finance</strong></td>
<td><ul>
<li><p>Tổng giờ công, quỹ lương dự kiến, headcount phục vụ payroll, công chưa khóa và lỗi công.</p></li>
<li><p>Trạng thái kỳ lương hiện tại, số phiếu lương chưa phát và sự kiện cần đối soát.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>2</strong></td>
<td><strong>Bảng chấm công</strong></td>
<td><ul>
<li><p>Tổng hợp công theo nhân viên, chi nhánh và kỳ.</p></li>
<li><p>Ngày/giờ tiêu chuẩn, giờ thực tế, giờ tính lương, OT nếu có, trễ và lỗi.</p></li>
<li><p>Chỉ dùng dữ liệu công đã được xác nhận theo quy trình.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>3</strong></td>
<td><strong>Đối soát công</strong></td>
<td><ul>
<li><p>Kiểm tra dữ liệu Store/HR đã xác nhận.</p></li>
<li><p>Phát hiện thiếu lượt check-in/out, adjustment đang chờ hoặc dữ liệu bất thường.</p></li>
<li><p>Không tự sửa event gốc.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>4</strong></td>
<td><strong>Kỳ lương</strong></td>
<td><ul>
<li><p>Tạo kỳ lương và chọn thời gian.</p></li>
<li><p>Trạng thái DRAFT -&gt; RECONCILE -&gt; APPROVED -&gt; PUBLISHED -&gt; PAID.</p></li>
<li><p>Lưu snapshot dữ liệu để tránh kết quả thay đổi khi dữ liệu nguồn sau này đổi.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>5</strong></td>
<td><strong>Tính lương</strong></td>
<td><ul>
<li><p>Tính theo đơn giá có ngày hiệu lực và giờ được duyệt.</p></li>
<li><p>Tổng hợp OT, phụ cấp, thưởng và adjustment hợp lệ theo chính sách đã chốt.</p></li>
<li><p>Không tự áp dụng phạt/khấu trừ chưa được phê duyệt.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>6</strong></td>
<td><strong>Chi tiết lương NV</strong></td>
<td><ul>
<li><p>Breakdown từng nhân viên: giờ, đơn giá, phụ cấp, bonus, điều chỉnh và tổng.</p></li>
<li><p>Cho phép truy vết nguồn dữ liệu công/rate snapshot.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>7</strong></td>
<td><strong>Phiếu lương</strong></td>
<td><ul>
<li><p>Tạo/kiểm tra phiếu lương cá nhân.</p></li>
<li><p>Chỉ phát phiếu sau trạng thái PUBLISHED.</p></li>
<li><p>Nhân viên chỉ được xem phiếu của chính mình.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>8</strong></td>
<td><strong>Đối soát Phiếu lương</strong></td>
<td><ul>
<li><p>So sánh công đã khóa với tiền lương.</p></li>
<li><p>Tìm sai lệch và tạo revision/adjustment nếu cần.</p></li>
<li><p>Không sửa đè phiếu đã PUBLISHED.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>9</strong></td>
<td><strong>Thanh toán</strong></td>
<td><ul>
<li><p>Đánh dấu PAID khi đáp ứng điều kiện và có chứng từ/ghi nhận phù hợp.</p></li>
<li><p>Lưu ngày thanh toán, người cập nhật và trạng thái.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>10</strong></td>
<td><strong>Báo cáo Finance</strong></td>
<td><ul>
<li><p>Quỹ lương, chi phí nhân sự theo chi nhánh, tổng giờ và lịch sử kỳ lương.</p></li>
<li><p>Labor Cost % chỉ hiển thị nếu có dữ liệu doanh thu đầu vào đáng tin cậy.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>11</strong></td>
<td><strong>Thông báo Finance</strong></td>
<td><ul>
<li><p>Công chưa chốt, lỗi calculation, adjustment, bảng lương cần xử lý và kỳ lương sắp tới.</p></li>
<li><p>Không gửi thông tin lương chi tiết vào kênh không riêng tư.</p></li>
</ul></td>
</tr>
</tbody>
</table>

# **6. TÀI KHOẢN MKT**

Truyền thông nội bộ cho nhân viên.

| **9 TAB** | MKT quản lý nội dung và phân phối thông báo; không được xem lương, GPS, ảnh điểm danh hoặc hồ sơ HR nhạy cảm. |
|-----------|---------------------------------------------------------------------------------------------------------------|

<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>#</strong></th>
<th><strong>TAB / MÀN HÌNH</strong></th>
<th><strong>CHỨC NĂNG CỤ THỂ</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>1</strong></td>
<td><strong>Dashboard MKT</strong></td>
<td><ul>
<li><p>Tin đang chạy, tin nháp, lịch phát, nhóm người nhận và trạng thái gửi.</p></li>
<li><p>Hiển thị các nội dung chờ duyệt/lỗi gửi nếu quy trình yêu cầu.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>2</strong></td>
<td><strong>Tạo thông báo</strong></td>
<td><ul>
<li><p>Tạo tiêu đề, nội dung, ảnh/tệp đính kèm, CTA và mức độ thông báo.</p></li>
<li><p>Lưu DRAFT trước khi phát.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>3</strong></td>
<td><strong>Nhóm người nhận</strong></td>
<td><ul>
<li><p>Chọn toàn công ty, theo chi nhánh, nhân viên thử việc/chính thức hoặc nhóm được cấu hình.</p></li>
<li><p>Không được truy cập các dữ liệu HR nhạy cảm để tạo nhóm ngoài phạm vi cho phép.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>4</strong></td>
<td><strong>Lịch phát thông báo</strong></td>
<td><ul>
<li><p>Phát ngay hoặc đặt lịch theo ngày/giờ.</p></li>
<li><p>Hiển thị trạng thái scheduled/sent/failed.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>5</strong></td>
<td><strong>Nội dung đã phát</strong></td>
<td><ul>
<li><p>Danh sách thông báo, ngày gửi, người tạo, nhóm nhận và trạng thái.</p></li>
<li><p>Cho phép tra cứu lịch sử nội dung.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>6</strong></td>
<td><strong>Notification Campaign</strong></td>
<td><ul>
<li><p>Gom nhiều thông báo theo chiến dịch truyền thông nội bộ.</p></li>
<li><p>Theo dõi tiến độ và trạng thái phát.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>7</strong></td>
<td><strong>Media</strong></td>
<td><ul>
<li><p>Quản lý ảnh/tài liệu dùng cho thông báo theo quyền.</p></li>
<li><p>Tệp lưu Drive hoặc kho tệp được phê duyệt; không public dữ liệu nội bộ ngoài chủ đích.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>8</strong></td>
<td><strong>Theo dõi gửi</strong></td>
<td><ul>
<li><p>Trạng thái Pending/Sent/Failed, số lần retry và lỗi gần nhất.</p></li>
<li><p>Không khẳng định người nhận đã đọc nếu nhà cung cấp không có receipt đọc.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>9</strong></td>
<td><strong>Thông báo MKT</strong></td>
<td><ul>
<li><p>Báo lỗi phát tin, nội dung chờ duyệt và lịch phát sắp tới.</p></li>
<li><p>MKT không xem lương, GPS, ảnh điểm danh hoặc hồ sơ nhạy cảm.</p></li>
</ul></td>
</tr>
</tbody>
</table>

# **7. NHÂN VIÊN THỬ VIỆC**

Giao diện mobile-first theo giai đoạn PROBATION.

| **9 TAB** | Dùng chung Web App Nhân viên. Menu được hiển thị theo giai đoạn và feature flags từ backend; lịch 12 ngày/7 làm/5 OFF chỉ áp dụng nếu chính sách vị trí đã được duyệt. |
|-----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>#</strong></th>
<th><strong>TAB / MÀN HÌNH</strong></th>
<th><strong>CHỨC NĂNG CỤ THỂ</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>1</strong></td>
<td><strong>Trang chủ</strong></td>
<td><ul>
<li><p>Hiển thị họ tên, mã NV, chi nhánh, trạng thái tài khoản và giai đoạn THỬ VIỆC.</p></li>
<li><p>Ca hôm nay/ca tiếp theo, trạng thái check-in/out, số ngày thử việc đã qua và còn lại.</p></li>
<li><p>Hiển thị OFF đã đăng ký, TEST sắp tới và yêu cầu đang chờ.</p></li>
<li><p>Nút hành động nhanh: Điểm danh, Xem lịch, Đăng ký OFF, TEST.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>2</strong></td>
<td><strong>Lịch thử việc</strong></td>
<td><ul>
<li><p>Hiển thị chu kỳ thử việc theo chính sách đang áp dụng, ví dụ mẫu 12 ngày.</p></li>
<li><p>Mỗi ngày thể hiện WORKING/OFF, ca, chi nhánh và trạng thái lịch.</p></li>
<li><p>Chỉ lịch PUBLISHED mới được coi là lịch làm chính thức.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>3</strong></td>
<td><strong>Đăng ký OFF thử việc</strong></td>
<td><ul>
<li><p>Chọn ngày OFF trong phạm vi giai đoạn thử việc theo chính sách được duyệt.</p></li>
<li><p>Lưu nháp, gửi yêu cầu và xem Pending/Approved/Rejected.</p></li>
<li><p>Hiển thị lý do từ chối nếu có.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>4</strong></td>
<td><strong>Điểm danh</strong></td>
<td><ul>
<li><p>Check-in/check-out theo assignment PUBLISHED.</p></li>
<li><p>Kiểm tra GPS/bán kính và accuracy theo cấu hình.</p></li>
<li><p>Mở camera trực tiếp getUserMedia; chụp ảnh theo quy trình.</p></li>
<li><p>Chỉ hiện thành công sau khi dữ liệu cần thiết được lưu/ghi nhận thành công.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>5</strong></td>
<td><strong>Công của tôi</strong></td>
<td><ul>
<li><p>Xem ngày làm, ca, check-in, check-out, tổng giờ và trạng thái công.</p></li>
<li><p>Hiển thị cờ đi trễ/về sớm/thiếu lượt hoặc sự cố.</p></li>
<li><p>Không được sửa trực tiếp dữ liệu công.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>6</strong></td>
<td><strong>Đổi ca / Nghỉ khẩn</strong></td>
<td><ul>
<li><p>Gửi yêu cầu đổi ca theo điều kiện cho phép; theo dõi NV B xác nhận và HR/Store duyệt.</p></li>
<li><p>Gửi yêu cầu nghỉ đột xuất kèm lý do.</p></li>
<li><p>Theo dõi trạng thái người thay/ca chưa được phủ nếu có.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>7</strong></td>
<td><strong>Bổ sung công</strong></td>
<td><ul>
<li><p>Báo quên check-in/check-out, GPS/camera lỗi hoặc sự cố liên quan.</p></li>
<li><p>Nhập lý do và bằng chứng nếu được yêu cầu.</p></li>
<li><p>Theo dõi kết quả HR/Store xử lý.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>8</strong></td>
<td><strong>Thi TEST</strong></td>
<td><ul>
<li><p>Xem bài TEST được giao và thời gian mở bài.</p></li>
<li><p>Làm bài có countdown server-side; tự nộp khi hết thời gian nếu cấu hình.</p></li>
<li><p>Xem điểm, kết quả, thi lại và lịch sử theo quyền.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>9</strong></td>
<td><strong>Thông báo &amp; Phiếu lương</strong></td>
<td><ul>
<li><p>Nhận lịch mới, kết quả OFF/đổi ca, TEST, công bất thường và thông báo công ty.</p></li>
<li><p>Xem phiếu lương cá nhân đã PUBLISHED nếu chức năng lương và quyền riêng tư đã được bật.</p></li>
</ul></td>
</tr>
</tbody>
</table>

# **8. NHÂN VIÊN CHÍNH THỨC**

Giao diện mobile-first theo giai đoạn OFFICIAL.

| **9 TAB** | Dùng chung Web App Nhân viên; nhân viên chỉ xem dữ liệu của chính mình và các chức năng được phân quyền. |
|-----------|----------------------------------------------------------------------------------------------------------|

<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>#</strong></th>
<th><strong>TAB / MÀN HÌNH</strong></th>
<th><strong>CHỨC NĂNG CỤ THỂ</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>1</strong></td>
<td><strong>Trang chủ</strong></td>
<td><ul>
<li><p>Hiển thị họ tên, mã NV, chi nhánh, trạng thái CHÍNH THỨC.</p></li>
<li><p>Ca hôm nay, trạng thái check-in/out, lịch ngày mai và OFF trong tuần.</p></li>
<li><p>Hiển thị yêu cầu đổi ca, thông báo mới và cảnh báo cần xử lý.</p></li>
<li><p>Nút nhanh ưu tiên Điểm danh, Lịch làm việc và OFF.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>2</strong></td>
<td><strong>Lịch làm việc</strong></td>
<td><ul>
<li><p>Xem lịch tuần T2-CN, ca Sáng/Chiều/Tối, OFF và chi nhánh.</p></li>
<li><p>Xem tuần hiện tại và tuần kế tiếp khi đã PUBLISHED.</p></li>
<li><p>Không tự sửa lịch đã phát.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>3</strong></td>
<td><strong>Đăng ký OFF tuần</strong></td>
<td><ul>
<li><p>Chọn ngày nghỉ theo chính sách áp dụng.</p></li>
<li><p>Kiểm tra giới hạn OFF và định biên; gửi yêu cầu.</p></li>
<li><p>Xem trạng thái Pending/Approved/Rejected và lý do.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>4</strong></td>
<td><strong>Điểm danh</strong></td>
<td><ul>
<li><p>Check-in/check-out bằng GPS + camera theo ca đã PUBLISHED.</p></li>
<li><p>Hiển thị giờ ghi nhận, khoảng cách/trạng thái GPS và trạng thái sự kiện.</p></li>
<li><p>Có luồng ngoại lệ khi GPS/camera lỗi; không tự kết luận gian lận.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>5</strong></td>
<td><strong>Công của tôi</strong></td>
<td><ul>
<li><p>Xem công theo ngày/tuần/tháng, giờ vào/ra, tổng giờ và OT nếu có.</p></li>
<li><p>Hiển thị trễ, về sớm, thiếu lượt và trạng thái công.</p></li>
<li><p>Có nút yêu cầu bổ sung công khi phát hiện sai.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>6</strong></td>
<td><strong>Đổi ca</strong></td>
<td><ul>
<li><p>Chọn ca cần đổi, đồng nghiệp và nội dung đổi.</p></li>
<li><p>Theo dõi timeline: gửi -&gt; NV B xác nhận -&gt; Store/HR duyệt -&gt; hoàn tất.</p></li>
<li><p>Chỉ sau duyệt cuối cùng lịch mới được cập nhật.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>7</strong></td>
<td><strong>Nghỉ khẩn &amp; Bổ sung công</strong></td>
<td><ul>
<li><p>Gửi nghỉ đột xuất; theo dõi tình trạng tìm người thay/escalation.</p></li>
<li><p>Gửi yêu cầu bổ sung công khi quên check-in/out hoặc có sự cố.</p></li>
<li><p>Xem quyết định xử lý và lý do.</p></li>
</ul></td>
</tr>
<tr class="even">
<td><strong>8</strong></td>
<td><strong>TEST / Đào tạo</strong></td>
<td><ul>
<li><p>Chỉ hiển thị bài TEST/đào tạo khi HR giao.</p></li>
<li><p>Xem lịch, làm bài, kết quả và lịch sử theo quyền.</p></li>
</ul></td>
</tr>
<tr class="odd">
<td><strong>9</strong></td>
<td><strong>Thông báo &amp; Phiếu lương</strong></td>
<td><ul>
<li><p>Nhận lịch mới, OFF, đổi ca, công, thông báo nội bộ và phiếu lương.</p></li>
<li><p>Chỉ xem phiếu lương cá nhân đã PUBLISHED; có thể gửi phản hồi/báo sai nếu chức năng được bật.</p></li>
</ul></td>
</tr>
</tbody>
</table>

# **9. Nguyên tắc phân quyền cần khóa trong code**

- Backend luôn kiểm tra role, permission và branchScope; không chỉ ẩn nút ở frontend.

- Admin quản hệ thống và kích hoạt tài khoản; HR quản nghiệp vụ nhân sự; Store quản vận hành chi nhánh; Finance quản công/lương; MKT quản truyền thông.

- Nhân viên Thử việc và Chính thức dùng một Web App, nhưng backend trả employment_stage/features để hiển thị đúng menu.

- Nhân viên chỉ được xem dữ liệu của chính mình; Store chỉ xem dữ liệu trong branchScope.

- Mọi thao tác ghi quan trọng chỉ báo thành công sau khi Google Sheets xác nhận ghi; Socket chỉ phát sự kiện sau đó.

- Không xóa lịch sử nghiệp vụ bằng thao tác thông thường; thay đổi quan trọng cần audit.

- Phiếu lương đã phát không sửa đè; dùng revision/adjustment.

- Dữ liệu ảnh/GPS/lương là dữ liệu hạn chế truy cập và không được đưa vào thông báo nhóm công khai.

**KẾT LUẬN: 01 Web App Quản trị + 01 Web App Nhân viên, tổng cộng 07 cấu hình giao diện/quyền theo tài khoản. Đây là cấu trúc tab/chức năng đề xuất chính thức để tiếp tục đặc tả API, Google Sheet đọc/ghi và Socket event cho từng màn hình.**
