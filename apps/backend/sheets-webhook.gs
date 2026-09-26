/**
 * UBM MILK HR - Sheet -> Web realtime (1-2s)
 * File này dán vào Extensions > Apps Script của file Google Sheet MASTER.
 *
 * CÀI ĐẶT 1 LẦN (3 phút):
 *  1. Điền BACKEND_URL + WEBHOOK_SECRET bên dưới (SECRET lấy trên Render Dashboard,
 *     biến môi trường SHEETS_WEBHOOK_SECRET — phải TRÙNG với server).
 *  2. Bấm Save (Ctrl+S), chọn function installCheck rồi bấm Run 1 lần để cấp quyền.
 *  3. Vào Triggers (đồng hồ bên trái) > Add Trigger:
 *       function: onEditInstallable | event source: From spreadsheet |
 *       event type: On edit > Save.
 *  4. Sửa thử 1 ô trên Sheet, xem web app cập nhật trong 1-2 giây.
 *
 * LƯU Ý:
 *  - Phải dùng trigger CÀI ĐẶT (bước 3), trigger đơn giản không gọi được ra ngoài.
 *  - Chỉ bắn khi có người SỬA TAY trên Sheet; code server tự ghi thì web đã realtime sẵn.
 *  - Chống dồn: tối đa 1 lần bắn/5 giây.
 */

const BACKEND_URL = 'https://umb-nhansu-database.onrender.com';
const WEBHOOK_SECRET = 'DAN-SECRET-VAO-DAY';
const MIN_GAP_MS = 5000;

function onEditInstallable(e) {
  try {
    var tab = '';
    if (e && e.range && e.range.getSheet) {
      tab = e.range.getSheet().getName();
    }
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty('ubm_last_push') || 0);
    var now = Date.now();
    if (now - last < MIN_GAP_MS) return;
    props.setProperty('ubm_last_push', String(now));

    UrlFetchApp.fetch(BACKEND_URL + '/hooks/sheets-edit', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: JSON.stringify({
        tab: tab,
        editedAt: new Date().toISOString(),
      }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    // Không chặn thao tác sửa của người dùng vì bất kỳ lỗi nào.
  }
}

/** Chạy tay 1 lần để kiểm tra kết nối (xem View > Executions lấy kết quả). */
function installCheck() {
  var res = UrlFetchApp.fetch(BACKEND_URL + '/ping', { muteHttpExceptions: true });
  Logger.log('ping: ' + res.getContentText());
}
