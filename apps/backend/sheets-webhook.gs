/**
 * UBM MILK HR - Sheet -> Web realtime (1-2s)
 * File này dán vào Extensions > Apps Script của file Google Sheet MASTER.
 *
 * CÀI ĐẶT 1 LẦN (3 phút):
 *  1. Điền BACKEND_URL bên dưới. Điền WEBHOOK_SECRET đúng bằng biến môi trường
 *     SHEETS_WEBHOOK_SECRET trên VPS (hoặc tạo Script Property tên
 *     UBM_WEBHOOK_SECRET — cách này không cần sửa code).
 *  2. Bấm Save (Ctrl+S), chọn function installCheck rồi bấm Run 1 lần để cấp quyền
 *     và xem kết quả (phải thấy webhook: 200).
 *  3. Vào Triggers (đồng hồ bên trái) > Add Trigger:
 *       function: onEditInstallable | event source: From spreadsheet |
 *       event type: On edit > Save.
 *  4. Sửa thử 1 ô trên Sheet, xem web app cập nhật trong 1-2 giây.
 *
 * LƯU Ý:
 *  - Phải dùng trigger CÀI ĐẶT (bước 3), trigger đơn giản không gọi được ra ngoài.
 *  - Chỉ bắn khi có người SỬA TAY trên Sheet; code server tự ghi thì web đã realtime sẵn.
 *  - Không chặn theo thời gian ở đây: server tự gộp các lần sửa liên tiếp và luôn
 *    chạy thêm một lượt pull bù để không bỏ mất lần sửa cuối.
 */

const BACKEND_URL = 'https://umbomilk-nhansu-diemdanh.duckdns.org/api';
// Điền secret trùng SHEETS_WEBHOOK_SECRET trên VPS, hoặc set Script Property
// UBM_WEBHOOK_SECRET (Project Settings > Script Properties) rồi để nguyên dòng này.
const WEBHOOK_SECRET = 'DAN-SECRET-VAO-DAY';
const SECRET_PLACEHOLDER = 'DAN-SECRET-VAO-DAY';

function getWebhookSecret_() {
  try {
    var fromProp = PropertiesService.getScriptProperties().getProperty('UBM_WEBHOOK_SECRET');
    if (fromProp && fromProp.trim()) return fromProp.trim();
  } catch (e) { /* fallback hằng số bên dưới */ }
  return String(WEBHOOK_SECRET || '').trim();
}

function onEditInstallable(e) {
  try {
    var tab = '';
    if (e && e.range && e.range.getSheet) {
      tab = e.range.getSheet().getName();
    }

    UrlFetchApp.fetch(BACKEND_URL.replace(/\/$/, '') + '/hooks/sheets-edit', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-webhook-secret': getWebhookSecret_() },
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
  var base = BACKEND_URL.replace(/\/$/, '');
  var ping = UrlFetchApp.fetch(base + '/ping', { muteHttpExceptions: true });
  Logger.log('ping: ' + ping.getResponseCode() + ' ' + ping.getContentText());

  var secret = getWebhookSecret_();
  if (!secret || secret === SECRET_PLACEHOLDER) {
    Logger.log('CHUA CAU HINH: dien WEBHOOK_SECRET trong file nay hoac Script Property UBM_WEBHOOK_SECRET, dung bang SHEETS_WEBHOOK_SECRET tren VPS.');
    return;
  }

  var res = UrlFetchApp.fetch(base + '/hooks/sheets-edit', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': secret },
    payload: JSON.stringify({ tab: 'INSTALL_CHECK', editedAt: new Date().toISOString() }),
    muteHttpExceptions: true,
  });
  Logger.log('webhook: ' + res.getResponseCode() + ' ' + res.getContentText());
  if (res.getResponseCode() === 403) {
    Logger.log('SAI SECRET: gia tri trong Apps Script khac SHEETS_WEBHOOK_SECRET trong .env tren VPS.');
  }
}
