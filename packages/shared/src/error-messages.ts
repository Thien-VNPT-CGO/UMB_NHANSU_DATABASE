/**
 * Từ điển lỗi tiếng Việt dùng chung cho Backend, cổng Quản trị (Admin) và
 * cổng Nhân viên.
 *
 * Mục tiêu: KHÔNG BAO GIỜ hiển thị nguyên mã lỗi tiếng Anh
 * (VD: VEHICLE_NOT_FOUND, SHIFT_NOT_FOUND, VALIDATION_ERROR...) cho người dùng.
 * Mọi thông báo lỗi đều được chuyển sang câu tiếng Việt thân thiện; mã gốc vẫn
 * được giữ ở trường `error`/`err.code` để client xử lý logic.
 */

const DEFAULT_ERROR_MESSAGE =
  'Đã xảy ra lỗi trên hệ thống. Vui lòng thử lại hoặc liên hệ bộ phận hỗ trợ.';

/** Mã lỗi -> câu thông báo tiếng Việt. */
export const ERROR_CODE_MESSAGES: Record<string, string> = {
  // ---------------------------------------------------------------- Tài khoản / đăng nhập
  ACCOUNT_LOCKED: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên để mở khóa.',
  ACCOUNT_NOT_FOUND: 'Không tìm thấy tài khoản trong hệ thống.',
  ACCOUNT_NOT_LOCKED: 'Tài khoản đang hoạt động bình thường, không cần mở khóa.',
  ACCOUNT_REVOKED: 'Tài khoản đã bị thu hồi hoặc thay đổi quyền. Vui lòng đăng nhập lại.',
  ADMIN_NOT_FOUND: 'Không tìm thấy tài khoản quản trị.',
  INVALID_CREDENTIALS: 'Tên đăng nhập hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.',
  INVALID_PIN: 'Mã PIN không chính xác.',
  PIN_NOT_SET: 'Tài khoản chưa được cấp mã PIN. Vui lòng liên hệ HR để nhận mã.',
  PIN_NOT_AVAILABLE: 'Tài khoản này chưa có mã PIN để xem.',
  PIN_CHANGE_REQUIRED: 'Bạn cần đổi mã PIN theo chu kỳ trước khi tiếp tục sử dụng.',
  PIN_RESET_DISABLED: 'Chức năng đặt lại mã PIN đang tạm khóa.',
  SAME_PIN: 'Mã PIN mới phải khác mã PIN cũ.',
  WEAK_PIN: 'Mã PIN quá yếu. Vui lòng chọn mã PIN khác an toàn hơn.',
  WEAK_PASSWORD: 'Mật khẩu quá yếu. Vui lòng chọn mật khẩu an toàn hơn.',
  RESET_PASS_INVALID: 'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
  RESET_PIN_FAILED: 'Đặt lại mã PIN thất bại. Vui lòng thử lại.',
  MISSING_CREDENTIALS: 'Vui lòng nhập đầy đủ thông tin đăng nhập.',
  MISSING_REFRESH_TOKEN: 'Thiếu mã gia hạn phiên đăng nhập.',
  INVALID_REFRESH_TOKEN: 'Mã gia hạn phiên không hợp lệ hoặc đã hết hạn.',
  REFRESH_REVOKED: 'Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.',
  TOKEN_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  TOKEN_REVOKED: 'Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.',
  INVALID_TOKEN: 'Mã xác thực không hợp lệ.',
  UNAUTHORIZED: 'Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  LOGIN_TEMPORARILY_LOCKED:
    'Bạn đã nhập sai quá nhiều lần. Vì an toàn, vui lòng thử lại sau ít phút.',
  DEVICE_SHARING: 'Tài khoản đang được đăng nhập trên thiết bị khác.',
  EMPLOYMENT_NOT_ELIGIBLE: 'Tài khoản không đủ điều kiện sử dụng chức năng này.',
  DUPLICATE_PHONE_NEEDS_HR:
    'Số điện thoại đang bị trùng nhiều hồ sơ. Vui lòng liên hệ HR để đối soát.',
  NOT_AN_EMPLOYEE: 'Tài khoản không gắn với hồ sơ nhân viên.',
  MISSING_EMPLOYEE: 'Thiếu thông tin nhân viên.',
  EMPLOYEE_NOT_FOUND: 'Không tìm thấy nhân viên trong hệ thống.',
  NOT_OFFICE_EMPLOYEE: 'Chức năng này chỉ dành cho nhân viên khối Văn Phòng.',
  OFFICE_PORTAL_ONLY: 'Chức năng này chỉ sử dụng được trên cổng Văn Phòng.',
  ORPHANED_ON_RESTART: 'Tác vụ bị gián đoạn do máy chủ khởi động lại. Vui lòng thử lại.',

  // ---------------------------------------------------------------- Chung / hệ thống
  INTERNAL_ERROR: 'Đã xảy ra lỗi trên hệ thống. Vui lòng thử lại hoặc liên hệ bộ phận hỗ trợ.',
  VALIDATION_ERROR: 'Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại.',
  INVALID_JSON: 'Dữ liệu gửi lên không đúng định dạng.',
  AUTHENTICATION_ERROR: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
  MISSING_FIELDS: 'Vui lòng nhập đầy đủ thông tin bắt buộc.',
  MISSING_ASSIGNMENT: 'Vui lòng chọn ca làm việc.',
  MISSING_REQUESTER: 'Vui lòng chọn nhân viên cần người làm thay.',
  MISSING_SHIFT: 'Vui lòng chọn ca cần người làm thay.',
  INVALID_GENDER: 'Giới tính không hợp lệ. Vui lòng chọn Nam, Nữ hoặc Khác.',
  TIMEOUT: 'Máy chủ xử lý quá lâu. Vui lòng thử lại.',
  SHEETS_TIMEOUT: 'Đồng bộ Google Sheets quá thời gian chờ. Vui lòng thử lại.',
  PULL_TIMEOUT: 'Tải dữ liệu Google Sheets quá thời gian chờ. Vui lòng thử lại.',
  PUSH_UNIFORM_TIMEOUT: 'Đồng bộ dữ liệu đồng phục quá thời gian chờ. Vui lòng thử lại.',
  NOTIFICATION_NOT_FOUND: 'Không tìm thấy thông báo.',
  OPERATION_NOT_FOUND: 'Không tìm thấy thao tác cần xử lý.',
  SNAPSHOT_NOT_FOUND: 'Không tìm thấy bản sao lưu (snapshot).',
  STORE_FORCE_FORBIDDEN: 'Tài khoản cửa hàng không được xóa ca đã hoàn thành. Vui lòng báo Admin/HR xử lý.',
  PHOTO_NOT_UPLOADED: 'Ảnh chưa được tải lên Google Drive.',
  PAYLOAD_TOO_LARGE: 'Dữ liệu hoặc tệp gửi lên quá lớn.',
  TOO_MANY_REQUESTS: 'Bạn thao tác quá nhanh. Vui lòng chờ một lát rồi thử lại.',
  CORS_FORBIDDEN: 'Nguồn truy cập không được phép.',
  WEBHOOK_FORBIDDEN: 'Yêu cầu webhook không được phép.',
  NOT_FOUND: 'Không tìm thấy dữ liệu yêu cầu.',
  NO_DATA: 'Không có dữ liệu.',
  ME_FAILED: 'Không tải được thông tin cá nhân. Vui lòng thử lại.',
  OVERVIEW_FAILED: 'Không tải được dữ liệu tổng quan. Vui lòng thử lại.',
  LIST_EMPLOYEES_FAILED: 'Không tải được danh sách nhân viên. Vui lòng thử lại.',
  VERSION_CONFLICT: 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại rồi thử tiếp.',
  NEEDS_RECONCILIATION:
    'Dữ liệu vừa ghi chưa đồng bộ hoàn tất. Vui lòng kiểm tra lại trước khi thao tác tiếp.',
  OPERATION_IN_PROGRESS: 'Thao tác trước đang được xử lý. Vui lòng chờ trong giây lát.',
  PERSIST_FAILED: 'Lưu dữ liệu thất bại. Vui lòng thử lại.',
  OUTBOX_NOT_READY: 'Hàng đợi đồng bộ chưa sẵn sàng. Vui lòng thử lại.',
  SYNC_NOT_READY: 'Dịch vụ đồng bộ chưa sẵn sàng. Vui lòng thử lại.',
  SYNC_SERVICE_MISSING: 'Không tìm thấy dịch vụ đồng bộ dữ liệu.',
  SYNC_SERVICE_NOT_READY: 'Dịch vụ đồng bộ chưa sẵn sàng. Vui lòng thử lại.',
  SHEET_SYNC_INVALID_RESULT: 'Kết quả đồng bộ Google Sheets không hợp lệ.',
  SHEETS_LOADING: 'Hệ thống đang khởi động và tải dữ liệu. Vui lòng thử lại sau ít giây.',
  SHEETS_UNAVAILABLE: 'Không đọc được dữ liệu Google Sheets. Vui lòng báo Admin/HR kiểm tra.',
  SHEETS_NOT_CONFIGURED: 'Hệ thống chưa cấu hình Google Sheets.',
  SHEETS_WEBHOOK_DISABLED: 'Đồng bộ webhook Google Sheets đang tắt.',
  GOOGLE_SHEETS_API_ERROR: 'Google Sheets đang gặp sự cố. Vui lòng thử lại sau.',
  SQL_RESTORE_NEEDS_PSQL: 'Cần công cụ phục hồi cơ sở dữ liệu để thực hiện thao tác này.',
  POSTGRES_NOT_CONFIGURED: 'Hệ thống chưa cấu hình cơ sở dữ liệu.',
  BACKUP_FILE_EMPTY: 'Tệp sao lưu rỗng hoặc không hợp lệ.',
  BACKUP_NO_SOURCES: 'Không có dữ liệu nguồn để sao lưu.',
  BACKUP_FAILED: 'Sao lưu dữ liệu thất bại. Vui lòng thử lại.',
  INVALID_BACKUP_KIND: 'Loại sao lưu không hợp lệ.',
  EXPORT_EMPTY: 'Không có dữ liệu để xuất.',
  FILE_EMPTY: 'Tệp rỗng hoặc không đọc được.',
  INVALID_IMAGE_DATA: 'Dữ liệu ảnh không hợp lệ.',
  PHOTO_NOT_FOUND: 'Không tìm thấy ảnh.',
  NO_PHOTOS: 'Không có ảnh nào.',
  AVATAR_NOT_UPLOADED: 'Chưa tải ảnh đại diện lên.',
  EMPTY_INLINE_PHOTO: 'Ảnh gửi lên bị rỗng. Vui lòng chọn ảnh khác.',
  INVALID_DATE: 'Ngày không hợp lệ.',
  INVALID_DATE_RANGE: 'Khoảng ngày không hợp lệ.',
  DATE_RANGE_TOO_LARGE_MAX_31_DAYS: 'Chỉ được chọn khoảng ngày tối đa 31 ngày mỗi lần.',
  BAD_DATE: 'Ngày không đúng định dạng.',
  BAD_RANGE: 'Khoảng thời gian không hợp lệ.',
  BAD_TIME: 'Giờ không đúng định dạng.',
  INVALID_TIME: 'Giờ không hợp lệ.',
  INVALID_MONTH: 'Tháng không hợp lệ.',
  INVALID_KIND: 'Loại dữ liệu không hợp lệ.',
  INVALID_STATUS: 'Trạng thái không hợp lệ.',
  INVALID_STEP: 'Bước xử lý không hợp lệ.',
  UNKNOWN_STEP: 'Bước xử lý không thuộc quy trình hiện tại.',
  INVALID_DECISION: 'Quyết định không hợp lệ.',
  INVALID_DEPARTMENT: 'Bộ phận không hợp lệ.',
  INVALID_EFFECTIVE_FROM: 'Ngày hiệu lực không hợp lệ.',
  INVALID_PAST_FROM: 'Kỳ hồi tố không hợp lệ.',
  INVALID_FORMULA: 'Công thức tính lương không hợp lệ.',
  INVALID_RATE: 'Đơn giá không hợp lệ.',
  INVALID_RANGE: 'Khoảng giá trị không hợp lệ.',
  INVALID_PHONE: 'Số điện thoại không hợp lệ.',
  INVALID_FULL_NAME: 'Họ tên không hợp lệ.',
  INVALID_GROUP: 'Khối làm việc không hợp lệ.',
  INVALID_SALARY_CONFIG: 'Cấu hình lương không hợp lệ.',
  INVALID_BANK_CONFIG: 'Thông tin ngân hàng không hợp lệ.',
  INVALID_CONTRACT_KIND: 'Loại tài liệu hợp đồng không hợp lệ.',
  INVALID_THEME_SCHEDULE: 'Lịch giao diện không hợp lệ.',
  MISSING_NAME: 'Vui lòng nhập tên.',
  MISSING_TITLE: 'Vui lòng nhập tiêu đề.',
  MISSING_REASON: 'Vui lòng nhập lý do.',
  REASON_REQUIRED: 'Vui lòng nhập lý do.',
  MISSING_DETAIL: 'Vui lòng nhập nội dung chi tiết.',
  MISSING_ITEMS: 'Vui lòng chọn ít nhất một mục.',
  MISSING_SIGNER_NAME: 'Thiếu tên người ký.',
  MISSING_SIGNATURES: 'Phiếu cần đủ chữ ký trước khi gửi nhân viên.',
  MISSING_SIGNATURE_IMAGES: 'Chưa có ảnh chữ ký mẫu. Vui lòng cài đặt chữ ký mẫu trước.',
  MISSING_CHECKIN_TIME: 'Ca chưa có giờ vào. Vui lòng nhập giờ vào.',
  MISSING_CHECKOUT_TIME: 'Ca chưa có giờ ra. Vui lòng nhập giờ ra.',
  INVALID_CHECKIN_TIME: 'Giờ vào không hợp lệ.',
  INVALID_CHECKOUT_TIME: 'Giờ ra không hợp lệ.',
  MAX_2_SHIFTS_PER_DAY: 'Mỗi ngày chỉ được xếp tối đa 2 ca làm việc.',
  FEATURE_DISABLED: 'Chức năng này chưa được quản trị viên mở.',

  // ---------------------------------------------------------------- Chi nhánh
  BRANCH_ALREADY_EXISTS: 'Chi nhánh này đã tồn tại.',
  BRANCH_COORDS_REQUIRED: 'Vui lòng nhập đầy đủ toạ độ chi nhánh.',
  BRANCH_ID_REQUIRED: 'Thiếu mã chi nhánh.',
  BRANCH_INVALID_NUMBER: 'Giá trị số của chi nhánh không hợp lệ.',
  BRANCH_NAME_REQUIRED: 'Vui lòng nhập tên chi nhánh.',
  BRANCH_NOT_FOUND: 'Không tìm thấy chi nhánh.',
  BRANCH_SCOPE_FORBIDDEN: 'Bạn không có quyền thao tác trên chi nhánh này.',
  BRANCH_SCOPE_VIOLATION: 'Bạn chỉ được thao tác trong phạm vi chi nhánh được phân quyền.',

  // ---------------------------------------------------------------- Ca làm việc / chấm công
  SHIFT_NOT_FOUND: 'Không tìm thấy ca làm việc.',
  INVALID_SHIFT_CODE: 'Mã ca cố định không hợp lệ. Chỉ chấp nhận CA_1, CA_2 hoặc CA_3.',
  EVENT_NOT_FOUND: 'Không tìm thấy bản ghi điểm danh. Vui lòng tải lại danh sách.',
  RECONCILE_BAD_RANGE: 'Khoảng ngày đối soát không hợp lệ. Vui lòng chọn từ ngày đến ngày đúng định dạng.',
  WINDOW_OUT_OF_RANGE: 'Ngày đã chọn nằm ngoài đợt đăng ký.',
  SHIFT_NOT_FOUND_FOR_DISPATCH: 'Không tìm thấy ca làm việc để điều phối.',
  SHIFTS_NOT_FOUND_FOR_SWAP: 'Không tìm thấy ca phù hợp để đổi.',
  SHIFT_CANCELLED: 'Ca làm việc đã bị hủy.',
  SHIFT_ALREADY_CANCELLED: 'Ca làm việc đã bị hủy trước đó.',
  SHIFT_ALREADY_COMPLETE: 'Ca làm việc đã hoàn tất.',
  SHIFT_HAS_ATTENDANCE: 'Ca đã có dữ liệu chấm công nên không thể thay đổi.',
  SHIFT_IN_PROGRESS: 'Ca đang diễn ra nên không thể thực hiện thao tác này.',
  SHIFT_NOT_IN_PROGRESS: 'Ca không ở trạng thái đang diễn ra.',
  SHIFT_NOT_SCHEDULED: 'Ca không ở trạng thái chờ bắt đầu.',
  SHIFT_NO_OWNER: 'Ca chưa được gán nhân viên.',
  SHIFT_REQUIRED_FIELDS: 'Vui lòng nhập đầy đủ thông tin ca.',
  SHIFT_DUPLICATE: 'Ca làm việc này đã tồn tại.',
  SHIFT_ARCHIVED_ATTENDANCE_LOCKED: 'Ca đã lưu trữ và có chấm công nên không thể sửa.',
  SHIFT_DATE_LOCKED_WITH_ATTENDANCE: 'Ngày này đã có chấm công nên không thể sửa ca.',
  ATTENDANCE_LOCKED: 'Bảng chấm công đã khóa.',
  ATTENDANCE_EVENT_NOT_FOUND: 'Không tìm thấy lượt chấm công.',
  ATTENDANCE_ALREADY_RECORDED: 'Lượt chấm công này đã được ghi nhận.',
  CHECKIN_NOT_FOUND: 'Không tìm thấy lượt vào ca.',
  CHECKIN_TOO_EARLY: 'Chưa đến giờ vào ca.',
  CHECKIN_NOT_OPEN: 'Cổng vào ca chưa mở.',
  CHECKIN_CLOSED: 'Cổng vào ca đã đóng.',
  CHECKIN_WRONG_SHIFT_ORDER: 'Bạn cần vào ca theo đúng thứ tự các ca trong ngày.',
  CHECKIN_REQUIRED_FIELDS: 'Thiếu thông tin để vào ca.',
  CHECKOUT_TOO_EARLY: 'Chưa đến giờ ra ca.',
  CHECKOUT_WITHOUT_CHECKIN: 'Bạn chưa vào ca nên không thể ra ca.',
  ALREADY_CHECKED_IN: 'Bạn đã vào ca rồi.',
  ALREADY_CHECKED_OUT: 'Bạn đã ra ca rồi.',
  ASSIGNMENT_NOT_OWNED: 'Ca làm việc này không thuộc về bạn.',
  GPS_REQUIRED: 'Chưa lấy được vị trí GPS. Vui lòng bật định vị và thử lại.',
  GPS_LOW_ACCURACY: 'Tín hiệu GPS quá yếu. Vui lòng ra nơi thoáng và thử lại.',
  GPS_ACCURACY_LOW: 'Độ chính xác GPS quá thấp. Vui lòng ra nơi thoáng và thử lại.',
  GPS_OUT_OF_BOUNDS: 'Bạn đang ở ngoài phạm vi cho phép nên chưa thể điểm danh.',
  OUTSIDE_GEOFENCE: 'Bạn đang ở ngoài phạm vi cho phép của điểm dừng.',
  WRONG_STOP_ORDER: 'Bạn cần điểm danh theo đúng thứ tự các điểm dừng.',
  OFFICE_DAY_OFF: 'Hôm nay là ngày nghỉ nên không cần vào ca.',
  CAMERA_REQUIRED: 'Vui lòng bật camera để chụp ảnh điểm danh.',

  // ---------------------------------------------------------------- Bù công / điều chỉnh
  ADJUSTMENT_NOT_FOUND: 'Không tìm thấy phiếu bổ sung công.',
  ADJUSTMENT_APPROVED_LOCKED: 'Phiếu đã được duyệt và ghi công nên không thể xóa.',
  ADJUSTMENT_NOT_APPROVED: 'Chỉ sửa được phiếu đã được duyệt.',
  ADJUSTMENT_NOT_OWNER: 'Bạn chỉ được hủy phiếu đang chờ của chính mình.',
  ADJUSTMENT_NOT_PENDING: 'Phiếu này đã được xử lý, không thể xử lý lại.',
  ADJUSTMENT_DUPLICATE: 'Bạn đã có phiếu bổ sung công cho ca này đang chờ duyệt.',
  ADJUSTMENT_DUPLICATE_PHOTO: 'Ảnh bằng chứng này đã được dùng cho phiếu khác.',
  ADJUSTMENT_SIMILAR_CONTENT: 'Nội dung phiếu bị trùng với phiếu đã gửi trước đó.',
  ADJUSTMENT_ID_REQUIRED: 'Thiếu mã phiếu bổ sung công.',
  ADJUSTMENT_NO_POINTS: 'Bạn không đủ điểm để gửi phiếu bù công.',
  ADJUSTMENT_NO_SHIFT: 'Ngày đã chọn không có ca làm việc nào được xếp.',
  ADJUSTMENT_PHOTO_INVALID: 'Ảnh bằng chứng không hợp lệ hoặc bị lỗi.',
  ADJUSTMENT_PHOTO_REQUIRED: 'Phiếu bổ sung công bắt buộc phải có ảnh bằng chứng.',
  ADJUSTMENT_WINDOW_CLOSED: 'Ngoài khung giờ nhận phiếu bổ sung công (08:00–21:00).',
  ADJUST_CLOSED: 'Phiếu đã được xử lý xong, không thể thao tác lại.',
  ADJUST_DUPLICATE: 'Bạn đã có phiếu bổ sung công cho ngày này đang chờ duyệt.',
  ADJUST_FUTURE: 'Không thể bổ sung công cho ngày chưa tới.',
  ADJUST_MONTH_LIMIT: 'Bạn đã dùng hết số phiếu bổ sung công của tháng này.',
  ADJUST_NOT_FOUND: 'Không tìm thấy phiếu bổ sung công.',
  APPROVER_FORBIDDEN: 'Phiếu bù công cả ngày do Giám đốc/HR duyệt. Bạn không có quyền duyệt phiếu này.',
  BU_CONG_NGAY_MONTH: 'Phiếu bù công ngày chỉ được chọn ngày trong tháng hiện tại.',
  BU_CONG_NGAY_MONTH_LIMIT: 'Bạn đã dùng hết số phiếu bù công ngày của tháng này.',
  BU_CONG_NGAY_WEEK_LIMIT: 'Tuần này bạn đã dùng phiếu bù công ngày. Vui lòng chờ tuần sau.',
  EMPTY_SLIP: 'Phiếu chưa có ngày hoặc ca nào.',

  // ---------------------------------------------------------------- Nghỉ phép / lịch nghỉ
  LEAVE_REQUEST_NOT_FOUND: 'Không tìm thấy phiếu nghỉ phép.',
  LEAVE_NOT_FOUND: 'Không tìm thấy phiếu nghỉ phép.',
  LEAVE_CLOSED: 'Phiếu nghỉ phép đã xử lý xong, không thể duyệt lại.',
  LEAVE_DAY_OFF: 'Ngày đã chọn là ngày nghỉ tuần nên không cần đăng ký nghỉ phép.',
  LEAVE_DUPLICATE: 'Bạn đã có phiếu nghỉ phép cho ngày này.',
  LEAVE_IN_PAST: 'Không thể đăng ký nghỉ cho ngày đã qua.',
  LEAVE_MONTH_LIMIT: 'Bạn đã dùng hết số ngày phép của tháng này.',
  LEAVE_MONTH_ONLY: 'Chỉ được đăng ký nghỉ phép trong tháng hiện tại.',
  LEAVE_NOT_PENDING: 'Phiếu nghỉ phép không ở trạng thái chờ duyệt.',
  LEAVE_NO_STEP: 'Phiếu nghỉ phép không còn bước duyệt nào.',
  LEAVE_WRONG_STEP: 'Phiếu đang chờ người khác duyệt, bạn không có quyền ở bước này.',
  EMERGENCY_LEAVE_NOT_GRANTED: 'Bạn chưa được cấp quyền báo nghỉ khẩn.',
  WEEKLY_OFF_REGISTRATION_REQUIRED: 'Bạn cần đăng ký 2 ngày nghỉ OFF trong tuần trước khi tiếp tục.',
  WEEKLY_OFF_WINDOW_CLOSED: 'Cổng đăng ký ngày nghỉ OFF đã đóng.',
  WEEKLY_OFF_DIFFERENT_WEEKS: 'Các ngày nghỉ phải thuộc cùng một tuần.',
  WEEKLY_OFF_DUPLICATE_DATES: 'Danh sách ngày nghỉ bị trùng.',
  WEEKLY_OFF_MISSING_DATES: 'Vui lòng chọn đủ ngày nghỉ.',
  WEEKLY_OFF_MUST_REGISTER_2_DAYS: 'Bạn phải đăng ký đúng 2 ngày nghỉ OFF mỗi tuần.',

  // ---------------------------------------------------------------- Đổi ca / hỗ trợ ca
  SWAP_REQUEST_NOT_FOUND: 'Không tìm thấy yêu cầu đổi ca.',
  SWAP_SHIFT_NOT_FOUND: 'Không tìm thấy ca cần đổi.',
  SWAP_SHIFT_CANCELLED: 'Ca cần đổi đã bị hủy.',
  SWAP_SHIFT_CHANGED: 'Ca cần đổi vừa bị thay đổi. Vui lòng tải lại.',
  SWAP_SHIFT_CONFLICT: 'Ca cần đổi bị trùng với ca khác.',
  SWAP_ALREADY_HANDLED: 'Yêu cầu đổi ca đã được xử lý.',
  SWAP_DATE_IN_PAST: 'Không thể đổi ca cho ngày đã qua.',
  SWAP_DUPLICATE: 'Yêu cầu đổi ca này đã tồn tại.',
  SWAP_EMPLOYEE_INVALID: 'Nhân viên đổi ca không hợp lệ.',
  SWAP_FORBIDDEN: 'Bạn không có quyền thực hiện yêu cầu đổi ca này.',
  SWAP_NOT_READY_FOR_APPROVAL: 'Yêu cầu đổi ca chưa sẵn sàng để duyệt.',
  CANNOT_SWAP_WITH_SELF: 'Bạn không thể đổi ca với chính mình.',
  COLLEAGUE_NOT_FOUND: 'Không tìm thấy đồng nghiệp.',
  DIFFERENT_BRANCH: 'Chỉ được đổi ca với đồng nghiệp cùng chi nhánh.',
  SUPPORT_NOT_OFFICIAL: 'Chỉ nhân viên chính thức mới được đăng ký hỗ trợ ca.',
  SUPPORT_OWNER_INVALID: 'Người đăng ký hỗ trợ ca không hợp lệ.',
  SUPPORT_SAME_EMPLOYEE: 'Bạn không thể tự hỗ trợ ca của chính mình.',
  SUPPORT_SHIFT_CONFLICT: 'Ca hỗ trợ bị trùng với ca làm việc khác.',
  CANNOT_ACCEPT_OWN_DISPATCH: 'Bạn không thể tự nhận ca điều phối của mình.',

  // ---------------------------------------------------------------- Lương / phiếu lương
  PAYSLIP_NOT_FOUND: 'Không tìm thấy phiếu lương.',
  PAYROLL_NOT_FOUND: 'Không tìm thấy dữ liệu lương.',
  PAYROLL_RUN_NOT_FOUND: 'Không tìm thấy kỳ tính lương.',
  PAYROLL_RUN_EMPTY: 'Kỳ lương chưa có phiếu lương nào.',
  PAYROLL_EXISTS: 'Kỳ lương này đã được tính trước đó.',
  PAYROLL_LOCKED: 'Kỳ lương đã khóa, không thể thay đổi.',
  PAYROLL_REQUIRED_FIELDS: 'Vui lòng nhập đầy đủ thông tin tính lương.',
  INVALID_PERIOD: 'Kỳ lương không hợp lệ. Định dạng đúng là YYYY-MM (VD: 2026-10).',
  SIGNER_ROLE_FORBIDDEN: 'Vai trò của bạn không được ký vào ô chữ ký này.',
  RUN_INVALID_TRANSITION: 'Không thể chuyển trạng thái kỳ lương theo thứ tự hiện tại.',
  RUN_NOT_ALL_PAID: 'Chưa thể chốt kỳ lương vì còn phiếu chưa chi trả.',
  STEP_LOCKED: 'Bước xử lý này đang bị khóa.',
  STEP_NOT_FOUND: 'Không tìm thấy bước xử lý.',
  DATA_NOT_READY: 'Chưa có đủ dữ liệu chấm công để xác nhận bước này.',
  DIRECTOR_SIGNATURE_REQUIRED: 'Phiếu lương phải được Giám đốc ký trước.',
  SEPARATION_OF_DUTIES_VIOLATION: 'Người lập kỳ lương không được tự duyệt kỳ lương của mình.',
  SALARY_CONFIG_READ_FAILED: 'Không đọc được cấu hình lương.',
  SALARY_CONFIG_NOT_PERSISTED: 'Chưa xác minh được cấu hình lương vừa lưu. Vui lòng thử lại.',
  SLIP_CLOSED: 'Phiếu lương đã đóng, không thể thay đổi.',
  SLIP_COMPLAINED: 'Phiếu lương đang bị khiếu nại, cần xử lý trước khi ký lại.',
  SLIP_LOCKED: 'Phiếu lương đã xác nhận hoặc chi trả nên không thể ký lại.',
  SLIP_NOT_CONFIRMED: 'Nhân viên chưa ký xác nhận phiếu lương.',
  SLIP_NOT_DRAFT: 'Phiếu lương không ở trạng thái nháp nên không thể gửi lại.',
  SLIP_NOT_PUBLISHED: 'Phiếu lương chưa được gửi đến nhân viên.',
  SLIP_NOT_RETURNABLE: 'Phiếu lương ở trạng thái hiện tại nên không thể hoàn lại.',
  NOTHING_TO_APPLY: 'Không có dòng dữ liệu hợp lệ để áp dụng.',
  INVALID_DECISION_APPROVAL: 'Quyết định duyệt không hợp lệ.',

  // ---------------------------------------------------------------- Tuyển dụng / bài test
  CANDIDATE_NOT_FOUND: 'Không tìm thấy ứng viên.',
  SUBMISSION_NOT_FOUND: 'Không tìm thấy bài làm.',
  TEST_NOT_FOUND: 'Không tìm thấy bài kiểm tra.',
  TEST_ALREADY_SUBMITTED: 'Bài kiểm tra đã được nộp, không thể nộp lại.',
  TEST_BAD_ANSWERS: 'Số đáp án không khớp với số câu hỏi.',
  TEST_BAD_QUESTION: 'Nội dung câu hỏi chưa hợp lệ.',
  TEST_BANK_NOT_CONFIGURED: 'Chưa cấu hình ngân hàng câu hỏi trên máy chủ.',
  TEST_BANK_NO_ACCESS: 'Tài khoản dịch vụ chưa được cấp quyền xem ngân hàng câu hỏi.',
  TEST_BANK_NO_TAB: 'Không tìm thấy trang tính ngân hàng câu hỏi.',
  TEST_BANK_READ_FAILED: 'Không đọc được ngân hàng câu hỏi.',
  TEST_EMPTY_QUESTIONS: 'Bài kiểm tra phải có ít nhất 1 câu hỏi.',
  TEST_FORBIDDEN: 'Bài kiểm tra này không được giao cho bạn.',
  TEST_MISSING_TITLE: 'Thiếu tiêu đề bài kiểm tra.',
  TEST_NO_ASSIGNEE: 'Chưa chọn nhân viên nào để giao bài.',
  TEST_TOO_MANY_ASSIGNEES: 'Mỗi lần chỉ được giao cho tối đa 200 nhân viên.',
  TEST_TOO_MANY_QUESTIONS: 'Bài kiểm tra chỉ được tối đa 100 câu hỏi.',
  INTERVIEW_PROPOSAL_NOT_FOUND: 'Không tìm thấy đề xuất lịch phỏng vấn.',
  RSVP_LINK_INVALID: 'Liên kết xác nhận đã hết hạn hoặc không hợp lệ. Vui lòng liên hệ HR.',
  BAD_TOKEN: 'Liên kết không hợp lệ hoặc đã hết hạn.',

  // ---------------------------------------------------------------- Danh sách đen / quy trình nội bộ
  ALREADY_BLACKLISTED: 'Nhân viên này đã nằm trong danh sách đen.',
  NOT_BLACKLISTED: 'Nhân viên này không nằm trong danh sách đen.',
  BLACKLIST_PROBATION_ONLY: 'Chỉ đưa nhân viên thử việc vào danh sách đen.',
  BLACKLIST_SAVE_FAILED: 'Chưa lưu được danh sách đen. Vui lòng thử lại.',
  UNBLACKLIST_SAVE_FAILED: 'Chưa gỡ được danh sách đen. Vui lòng thử lại.',
  INTERNAL_REQUEST_NOT_FOUND: 'Không tìm thấy yêu cầu nội bộ.',
  INTERNAL_REQUEST_CLOSED: 'Yêu cầu nội bộ đã đóng.',
  INTERNAL_REQUEST_ALREADY_APPROVED: 'Yêu cầu nội bộ đã được duyệt trước đó.',

  // ---------------------------------------------------------------- Tài liệu / hợp đồng
  CONTRACT_NOT_UPLOADED: 'Chưa tải tài liệu hợp đồng lên.',
  CONTRACT_FILE_INVALID: 'Tệp hợp đồng không hợp lệ hoặc không đọc được.',
  CONTRACT_FILE_TOO_LARGE: 'Tệp hợp đồng vượt quá dung lượng cho phép.',
  CONTRACT_FILE_TYPE: 'Chỉ nhận tệp PDF, JPG, PNG, WEBP, DOC hoặc DOCX.',
  AUDIT_LOG_SHEET_ID_NOT_FOUND: 'Không tìm thấy trang tính nhật ký hệ thống.',
  PDF_FONT_MISSING: 'Thiếu phông chữ để tạo phiếu lương PDF.',

  // ---------------------------------------------------------------- Ngân hàng
  BANK_CHANGE_REQUEST_NOT_FOUND: 'Không tìm thấy yêu cầu đổi số tài khoản ngân hàng.',
  DUPLICATE_BANK_ACCOUNT: 'Số tài khoản ngân hàng đã thuộc về nhân viên khác.',
  DUPLICATE_PHONE: 'Số điện thoại đã được dùng cho nhân viên khác.',

  // ---------------------------------------------------------------- Google Drive
  DRIVE_NOT_CONFIGURED: 'Google Drive chưa được cấu hình trên máy chủ.',
  DRIVE_FOLDER_NOT_FOUND: 'Không tìm thấy thư mục Google Drive.',
  DRIVE_FOLDER_CREATE_FAILED: 'Không tạo được thư mục Google Drive.',
  DRIVE_UPLOAD_FAILED: 'Tải tệp lên Google Drive thất bại.',
  DRIVE_UPLOAD_RETURNED_NO_ID: 'Google Drive không trả về mã tệp sau khi tải lên.',
  DRIVE_COPY_RETURNED_NO_ID: 'Google Drive không trả về mã tệp sau khi sao chép.',
  DRIVE_RETURNED_MOCK_ID: 'Google Drive đang chạy ở chế độ mô phỏng, chưa lưu tệp thật.',
  DRIVE_FILE_NOT_AVAILABLE: 'Không tìm thấy tệp trên Google Drive.',
  DRIVE_FILE_TOO_LARGE: 'Tệp trên Google Drive vượt quá dung lượng cho phép.',
  DRIVE_SYNC_FAILED: 'Đồng bộ Google Drive thất bại. Vui lòng thử lại.',
  DRIVE_ERROR: 'Google Drive gặp sự cố. Vui lòng thử lại.',
  PUSH_SHIFTS_FAILED: 'Đẩy lịch làm việc lên Google Sheets thất bại.',
  APPEND_FAILED: 'Ghi dữ liệu lên Google Sheets thất bại.',
  CREATE_TEMP_NO_ID: 'Không tạo được bản ghi tạm trên Google Sheets.',
  NO_ACCESS_TOKEN: 'Chưa có mã truy cập Google. Vui lòng kiểm tra cấu hình.',
  EXCEL_BAD_FILE: 'Tệp Excel không hợp lệ hoặc không đọc được.',
  EXCEL_BAD_WEEK: 'Tuần trong tệp Excel không hợp lệ.',
  EXCEL_EMPTY: 'Tệp Excel không có trang tính nào.',
  EXCEL_NOT_MONDAY: 'Ngày bắt đầu tuần trong tệp Excel phải là Thứ Hai.',
  EXCEL_WEEK_NOT_CONTINUOUS: 'Các tuần trong tệp Excel không liên tục.',

  // ---------------------------------------------------------------- Zalo
  ZALO_NOT_CONNECTED: 'Nick Zalo HR chưa kết nối. Vui lòng quét mã QR đăng nhập lại.',
  ZALO_USER_NOT_FOUND: 'Không tìm thấy người dùng Zalo.',
  ZALO_SEND_FAILED: 'Gửi tin nhắn Zalo thất bại. Vui lòng thử lại.',
  ZALO_LOOKUP_FAILED: 'Không tra cứu được tài khoản Zalo.',

  // ---------------------------------------------------------------- Vận chuyển / xe điện (MilkRoute EV)
  VEHICLE_NOT_FOUND: 'Không tìm thấy xe vận chuyển.',
  VEHICLE_PLATE_REQUIRED: 'Vui lòng nhập biển số xe.',
  VEHICLE_PLATE_EXISTS: 'Biển số xe này đã tồn tại.',
  VEHICLE_HAS_SHIFT: 'Xe đã được phân ca vào ngày này.',
  DRIVER_NOT_FOUND: 'Không tìm thấy tài xế.',
  DRIVER_HAS_SHIFT: 'Tài xế đã có ca vào ngày này.',
  ROUTE_NOT_FOUND: 'Không tìm thấy lộ trình.',
  ROUTE_NAME_REQUIRED: 'Vui lòng nhập tên lộ trình.',
  ROUTE_HAS_STOPS: 'Không thể xóa lộ trình đang có điểm dừng.',
  ROUTE_HAS_SHIFTS: 'Không thể xóa lộ trình đang có ca vận chuyển.',
  ROUTE_NOT_CONFIGURED: 'Lộ trình chưa được cấu hình điểm dừng.',
  STOP_NOT_FOUND: 'Không tìm thấy điểm dừng.',
  STOP_NAME_REQUIRED: 'Vui lòng nhập tên điểm dừng.',
  STOP_ORDER_INVALID: 'Thứ tự điểm dừng không hợp lệ.',
  STOP_ORDER_EXISTS: 'Thứ tự điểm dừng này đã có trên lộ trình.',
  STOP_ROUTE_REQUIRED: 'Thiếu lộ trình cho điểm dừng.',
  STOP_NOT_IN_ROUTE: 'Điểm dừng không thuộc lộ trình này.',
  STOP_HAS_CHECKINS: 'Điểm dừng đã có lượt điểm danh nên không thể xóa.',
  NO_START_STOP: 'Lộ trình không có điểm xuất phát.',
  NO_END_STOP: 'Lộ trình không có điểm kết thúc.',
  ROUTE_CHANGE_NOT_FOUND: 'Không tìm thấy phiếu đổi lộ trình.',
  ROUTE_CHANGE_INVALID_DATE: 'Ngày hiệu lực của phiếu đổi lộ trình không hợp lệ.',
  ROUTE_CHANGE_INVALID_STATUS: 'Trạng thái phiếu đổi lộ trình không cho phép thao tác này.',
  ROUTE_CHANGE_INVALID_STOPS: 'Danh sách điểm dừng của phiếu đổi lộ trình không hợp lệ.',
  ROUTE_CHANGE_NOT_PENDING: 'Phiếu đổi lộ trình không ở trạng thái chờ duyệt.',
  ROUTE_CHANGE_OVERLAP: 'Đã có phiếu đổi lộ trình trùng khoảng ngày hiệu lực.',
  ROUTE_CHANGE_ROUTE_REQUIRED: 'Vui lòng chọn lộ trình.',
  ROUTE_CHANGE_STOPS_REQUIRED: 'Lộ trình phải có ít nhất 2 điểm dừng.',
  TICKET_NOT_FOUND: 'Không tìm thấy phiếu sạc.',
  TICKET_NOT_APPROVED: 'Phiếu sạc chưa được duyệt.',
  TICKET_NOT_DELETABLE: 'Phiếu sạc ở trạng thái hiện tại nên không thể xóa.',
  TICKET_EXISTS: 'Đã có phiếu sạc cho ca này vào ngày này.',
  TICKET_REQUIRED_FIELDS: 'Thiếu thông tin phiếu sạc.',
  ALREADY_CHARGING: 'Phiếu sạc đang được thực hiện.',
  NOT_CHARGING: 'Chưa bắt đầu sạc.',
  ALREADY_ENDED: 'Phiếu sạc đã kết thúc.',
  DATE_IN_PAST: 'Ngày đã chọn đã qua. Vui lòng chọn hôm nay hoặc ngày tới.',
  CHECKIN_REQUIRED: 'Thiếu thông tin điểm danh.',
  APPROVE_TICKET_FAILED: 'Duyệt phiếu thất bại. Vui lòng thử lại.',

  // ---------------------------------------------------------------- Vi phạm
  DELETE_REGULATION_FAILED: 'Xóa quy định vi phạm thất bại.',
  DELETE_TICKET_FAILED: 'Xóa phiếu vi phạm thất bại.',
  LIST_REGULATIONS_FAILED: 'Không tải được danh sách quy định vi phạm.',
  LIST_TICKETS_FAILED: 'Không tải được danh sách phiếu vi phạm.',
};

/** Nhãn tiếng Việt cho các trường thường gặp trong lỗi xác thực dữ liệu. */
const FIELD_LABELS: Record<string, string> = {
  phone: 'Số điện thoại',
  pin: 'Mã PIN',
  oldPin: 'Mã PIN cũ',
  newPin: 'Mã PIN mới',
  username: 'Tên đăng nhập',
  password: 'Mật khẩu',
  oldPassword: 'Mật khẩu cũ',
  newPassword: 'Mật khẩu mới',
  refreshToken: 'Mã gia hạn phiên',
  name: 'Tên',
  title: 'Tiêu đề',
  reason: 'Lý do',
  notes: 'Ghi chú',
  date: 'Ngày',
  fromDate: 'Từ ngày',
  toDate: 'Đến ngày',
  dateFrom: 'Từ ngày',
  dateTo: 'Đến ngày',
  shift_date: 'Ngày ca',
  shiftDate: 'Ngày ca',
  period: 'Kỳ lương',
  employeeId: 'Nhân viên',
  employee_id: 'Nhân viên',
  branchId: 'Chi nhánh',
  branch_id: 'Chi nhánh',
  group: 'Khối làm việc',
  role: 'Vai trò',
  amount: 'Số tiền',
  rate: 'Đơn giá',
  quantity: 'Số lượng',
  latitude: 'Vĩ độ',
  longitude: 'Kinh độ',
  accuracy: 'Độ chính xác GPS',
  photo: 'Ảnh',
  images: 'Danh sách ảnh',
  file: 'Tệp',
  license_plate: 'Biển số xe',
  route_id: 'Lộ trình',
  vehicle_id: 'Xe',
  driver_id: 'Tài xế',
  stop_id: 'Điểm dừng',
  product_name: 'Tên sản phẩm',
  week_start: 'Ngày bắt đầu tuần',
  start_time: 'Giờ bắt đầu',
  end_time: 'Giờ kết thúc',
  body: 'Dữ liệu gửi lên',
  query: 'Tham số truy vấn',
  params: 'Tham số đường dẫn',
};

const VIETNAMESE_RE =
  /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i;

const ENGLISH_HINT_RE =
  /\b(the|is|are|was|were|cannot|can't|could|unable|failed|failure|invalid|required|missing|must|please|error|expected|received|greater|less|least|most|already|exists|does not|not found|forbidden|unauthorized|timeout|network|server|payload|unsupported|malformed|duplicate|conflict|denied|expired|unknown|unexpected|quota|exceeded|database|connection|fetch|request|response)\b/i;

const ZOD_TYPE_LABELS: Record<string, string> = {
  string: 'chuỗi ký tự',
  number: 'số',
  integer: 'số nguyên',
  boolean: 'đúng/sai',
  array: 'danh sách',
  object: 'đối tượng',
  null: 'rỗng',
  undefined: 'không có giá trị',
  nan: 'số không hợp lệ',
  bigint: 'số lớn',
  date: 'ngày',
  function: 'hàm',
  symbol: 'ký hiệu',
  void: 'rỗng',
};

export function hasVietnameseText(text: string): boolean {
  return VIETNAMESE_RE.test(text);
}

function viType(value: unknown): string {
  return ZOD_TYPE_LABELS[String(value || '').toLowerCase()] || 'giá trị hợp lệ';
}

function translateKnownEnglish(text: string): string | null {
  const t = text.trim();
  const lower = t.toLowerCase();

  // Thông báo kỹ thuật đặc thù từ dịch vụ bên ngoài — kiểm tra TRƯỚC các mẫu
  // chung (timeout/network) để không bị dịch thành câu chung chung.
  if (/google sheets api quota exceeded|quota exceeded or network timeout|quota exceeded/.test(lower)) {
    return ERROR_CODE_MESSAGES.SHEETS_UNAVAILABLE;
  }
  if (/partial write failed during multi-tab swap update/.test(lower)) {
    return ERROR_CODE_MESSAGES.NEEDS_RECONCILIATION;
  }
  if (/payroll creator cannot approve own payroll run/.test(lower)) {
    return ERROR_CODE_MESSAGES.SEPARATION_OF_DUTIES_VIOLATION;
  }

  // Lỗi mạng / trình duyệt
  if (/failed to fetch|load failed|networkerror|network request failed|network error/.test(lower)) {
    return 'Không kết nối được đến máy chủ. Vui lòng kiểm tra mạng rồi thử lại.';
  }
  if (/aborted|abort error|the operation was aborted|signal is aborted/.test(lower)) {
    return 'Yêu cầu đã quá thời gian chờ. Vui lòng thử lại.';
  }
  if (/timeout of \d+ms exceeded|timed out|timeout/.test(lower) && !hasVietnameseText(t)) {
    return 'Máy chủ phản hồi quá lâu. Vui lòng thử lại sau ít giây.';
  }
  if (/failed to fetch dynamically imported module|loading chunk/.test(lower)) {
    return 'Không tải được chức năng. Vui lòng tải lại trang.';
  }

  // Lỗi JavaScript thường gặp
  if (/cannot read propert(y|ies)|undefined is not|null is not|is not a function/.test(lower)) {
    return 'Dữ liệu xử lý bị thiếu hoặc không đúng. Vui lòng tải lại trang và thử lại.';
  }
  if (/unexpected token|json\.parse|unexpected end of json/.test(lower)) {
    return 'Dữ liệu nhận về không đúng định dạng. Vui lòng thử lại.';
  }
  if (/user denied|permission denied|permission dismissed/.test(lower)) {
    return 'Bạn đã từ chối quyền truy cập. Vui lòng bật quyền trong trình duyệt rồi thử lại.';
  }
  if (/geolocation is not supported|geolocation not supported/.test(lower)) {
    return 'Thiết bị không hỗ trợ định vị GPS.';
  }

  // Lỗi HTTP
  if (/^bad request$|^http\s*400$/.test(lower)) return 'Yêu cầu không hợp lệ.';
  if (/^unauthorized$|^http\s*401$/.test(lower)) return 'Bạn chưa đăng nhập hoặc phiên đã hết hạn.';
  if (/^forbidden$|^http\s*403$/.test(lower)) return 'Bạn không có quyền thực hiện thao tác này.';
  if (/^not found$|^http\s*404$/.test(lower)) return 'Không tìm thấy dữ liệu yêu cầu.';
  if (/^too many requests$|^http\s*429$/.test(lower)) {
    return 'Bạn thao tác quá nhanh. Vui lòng chờ một lát rồi thử lại.';
  }
  if (/^internal server error$|^http\s*5\d\d$/.test(lower)) {
    return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau ít giây.';
  }
  if (/^service unavailable$|^http\s*503$/.test(lower)) {
    return 'Máy chủ đang khởi động lại. Vui lòng thử lại sau ít giây.';
  }
  if (/^gateway timeout$|^http\s*504$/.test(lower)) {
    return 'Máy chủ phản hồi quá lâu. Vui lòng thử lại sau ít giây.';
  }

  // Thông báo kỹ thuật từ dịch vụ bên ngoài
  if (/empty batch read/.test(lower)) return 'Không đọc được dữ liệu từ Google Sheets.';
  if (/unknown error|something went wrong|an error occurred/.test(lower)) {
    return DEFAULT_ERROR_MESSAGE;
  }

  // Câu xác thực dữ liệu kiểu Zod
  if (/^required\.?$/.test(lower)) return 'Trường này là bắt buộc.';
  if (/^invalid input\.?$/.test(lower)) return 'Dữ liệu không hợp lệ.';
  if (/^invalid email\.?$/.test(lower)) return 'Email không hợp lệ.';
  if (/^invalid date\.?$/.test(lower)) return 'Ngày không hợp lệ.';
  if (/^invalid url\.?$/.test(lower)) return 'Đường dẫn không hợp lệ.';
  if (/^invalid enum value/.test(lower)) return 'Giá trị không nằm trong danh sách cho phép.';
  if (/^invalid literal value/.test(lower)) return 'Giá trị không hợp lệ.';

  let m = t.match(/^String must contain at least (\d+) character\(s\)\.?$/i);
  if (m) return `Phải có ít nhất ${m[1]} ký tự.`;
  m = t.match(/^String must contain at most (\d+) character\(s\)\.?$/i);
  if (m) return `Chỉ được tối đa ${m[1]} ký tự.`;
  m = t.match(/^String must contain exactly (\d+) character\(s\)\.?$/i);
  if (m) return `Phải có đúng ${m[1]} ký tự.`;
  m = t.match(/^Array must contain at least (\d+) element\(s\)\.?$/i);
  if (m) return `Phải có ít nhất ${m[1]} mục.`;
  m = t.match(/^Array must contain at most (\d+) element\(s\)\.?$/i);
  if (m) return `Chỉ được tối đa ${m[1]} mục.`;
  m = t.match(/^Array must contain exactly (\d+) element\(s\)\.?$/i);
  if (m) return `Phải có đúng ${m[1]} mục.`;
  m = t.match(/^Number must be greater than or equal to (.+?)\.?$/i);
  if (m) return `Giá trị phải lớn hơn hoặc bằng ${m[1]}.`;
  m = t.match(/^Number must be less than or equal to (.+?)\.?$/i);
  if (m) return `Giá trị phải nhỏ hơn hoặc bằng ${m[1]}.`;
  m = t.match(/^Number must be greater than (.+?)\.?$/i);
  if (m) return `Giá trị phải lớn hơn ${m[1]}.`;
  m = t.match(/^Number must be less than (.+?)\.?$/i);
  if (m) return `Giá trị phải nhỏ hơn ${m[1]}.`;
  m = t.match(/^Expected (.+?), received (.+?)\.?$/i);
  if (m) return `Dữ liệu phải là ${viType(m[1])}, nhưng nhận được ${viType(m[2])}.`;
  m = t.match(/^Invalid input: expected (.+?), received (.+?)\.?$/i);
  if (m) return `Dữ liệu phải là ${viType(m[1])}, nhưng nhận được ${viType(m[2])}.`;

  return null;
}

/**
 * Chuyển một mã lỗi / câu thông báo lỗi bất kỳ sang tiếng Việt.
 * - Giữ nguyên câu đã có tiếng Việt.
 * - Với dạng `CODE: nội dung tiếng Việt`, chỉ lấy phần nội dung.
 * - Với mã lỗi đã biết, trả câu tiếng Việt tương ứng.
 * - Không nhận diện được thì trả câu thông báo chung (không hiện mã tiếng Anh).
 */
export function toVietnameseErrorMessage(input: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (input === null || input === undefined) return fallback;
  let text = String(input).replace(/\u0000/g, '').trim();
  if (!text) return fallback;

  // Bỏ tiền tố "Error:" / "Lỗi:" nếu có.
  text = text.replace(/^(error|lỗi)\s*:\s*/i, '').trim();
  if (!text) return fallback;

  // 1) Mã lỗi chính xác.
  const upper = text.toUpperCase();
  if (ERROR_CODE_MESSAGES[upper]) return ERROR_CODE_MESSAGES[upper];

  // 2) Dạng "CODE: nội dung" hoặc "CODE - nội dung" hoặc "CODE:nội dung".
  const codeWithDetail = text.match(/^([A-Z][A-Z0-9_]{2,})\s*(?::|\s+-\s+)\s*([\s\S]+)$/);
  if (codeWithDetail) {
    const code = codeWithDetail[1].toUpperCase();
    let detail = codeWithDetail[2].trim();
    // Bỏ qua phần đuôi kỹ thuật chỉ gồm số/ký hiệu (GPS_LOW_ACCURACY:25, DRIVE_FILE_TOO_LARGE:1234).
    if (/^[\d.,:;\s/+-]+$/.test(detail)) return ERROR_CODE_MESSAGES[code] || fallback;
    // Nếu phần đuôi lại là một mã lỗi khác.
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(detail)) {
      return ERROR_CODE_MESSAGES[code] || ERROR_CODE_MESSAGES[detail] || fallback;
    }
    if (hasVietnameseText(detail)) return detail;
    const translatedDetail = translateKnownEnglish(detail);
    if (translatedDetail) return translatedDetail;
    return ERROR_CODE_MESSAGES[code] || fallback;
  }

  // 3) Câu đã có tiếng Việt -> giữ nguyên.
  if (hasVietnameseText(text)) return text;

  // 4) Câu tiếng Anh đã biết (Zod, lỗi mạng, HTTP...).
  const translated = translateKnownEnglish(text);
  if (translated) return translated;

  // 5) Mã lỗi chưa có trong từ điển.
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(text)) return fallback;

  // 6) Câu tiếng Anh không nhận diện được: không hiển thị nguyên văn cho người dùng.
  if (ENGLISH_HINT_RE.test(text) && !hasVietnameseText(text)) return fallback;

  return text;
}

/** Nhãn tiếng Việt của một trường dữ liệu (dùng trong chi tiết lỗi xác thực). */
export function toVietnameseFieldLabel(path: unknown): string {
  const raw = String(path || '').trim();
  if (!raw) return '';
  const last = raw.split('.').filter(Boolean).pop() || raw;
  return FIELD_LABELS[last] || FIELD_LABELS[raw] || '';
}

/**
 * Ghép danh sách lỗi xác thực (`details`) thành một câu tiếng Việt gọn gàng.
 * Không hiển thị tên field tiếng Anh nếu chưa có nhãn tiếng Việt.
 */
export function formatVietnameseErrorDetails(details: unknown): string {
  if (!Array.isArray(details) || details.length === 0) return '';
  const parts: string[] = [];
  for (const item of details) {
    const message = toVietnameseErrorMessage(
      typeof item === 'string' ? item : item?.message,
      '',
    ).trim();
    if (!message) continue;
    const label = toVietnameseFieldLabel(
      typeof item === 'string' ? '' : item?.path,
    );
    parts.push(label ? `${label}: ${message}` : message);
  }
  return [...new Set(parts)].join('; ');
}

/** Lấy mã lỗi từ một Error/response bất kỳ (giữ tương thích logic client). */
export function getErrorCode(err: any): string {
  if (!err) return '';
  const code = err?.code || err?.error;
  if (typeof code === 'string' && code.trim()) return code.trim();
  const msg = typeof err?.message === 'string' ? err.message : String(err);
  const m = msg.match(/^([A-Z][A-Z0-9_]{2,})(?::|\s|$)/);
  return m ? m[1] : '';
}
