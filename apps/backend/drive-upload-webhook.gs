/**
 * GOOGLE APPS SCRIPT — WEBHOOK UPLOAD ẢNH LÊN GOOGLE DRIVE
 * =======================================================
 * Dùng khi backend KHÔNG thể ghi Drive bằng Service Account (Gmail cá nhân) và
 * chưa/lười tạo OAuth2 refresh token. Script chạy dưới quyền CHỦ THƯ MỤC Drive
 * nên file tạo ra dùng đúng quota của tài khoản đó.
 *
 * CÁCH TRIỂN KHAI (1 lần, ~3 phút):
 *  1. Mở https://script.google.com -> New project.
 *  2. Dán toàn bộ nội dung file này vào Code.gs.
 *  3. Project Settings -> Script properties -> thêm:
 *       WEBHOOK_SECRET = <chuỗi bí mật tự đặt>
 *  4. Deploy -> New deployment -> type "Web app":
 *       - Execute as: Me (tài khoản sở hữu thư mục Drive)
 *       - Who has access: Anyone
 *     -> Deploy, copy "Web app URL" (dạng https://script.google.com/macros/s/.../exec)
 *  5. Trên VPS, thêm vào apps/backend/.env rồi restart backend:
 *       GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL=<Web app URL>
 *       GOOGLE_DRIVE_WEBHOOK_SECRET=<đúng WEBHOOK_SECRET ở bước 3>
 *  6. (Tùy chọn) Mở URL webhook bằng trình duyệt: phải thấy {"ok":true,...}
 */

function doGet() {
  return json_({ ok: true, service: 'ubm-drive-upload-webhook', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'EMPTY_BODY' });
    }
    var body = JSON.parse(e.postData.contents);

    // Xác thực chia sẻ bí mật (nếu đã cấu hình WEBHOOK_SECRET).
    var expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';
    if (expected) {
      var given = body.secret || (e.parameter && e.parameter.secret) || '';
      var header = '';
      try {
        header = (e.headers && (e.headers['X-Webhook-Secret'] || e.headers['x-webhook-secret'])) || '';
      } catch (ignore) { header = ''; }
      if (given !== expected && header !== expected) {
        return json_({ ok: false, error: 'FORBIDDEN' });
      }
    }

    // Tải file (backend proxy ảnh khi không có quyền đọc trực tiếp Drive API).
    if (String(body.action || '') === 'download') {
      var fid = String(body.fileId || '').trim();
      if (!fid) return json_({ ok: false, error: 'MISSING_FILE_ID' });
      var f = DriveApp.getFileById(fid);
      return json_({
        ok: true,
        fileId: fid,
        mimeType: f.getMimeType(),
        base64: Utilities.base64Encode(f.getBlob().getBytes()),
      });
    }

    var folderId = String(body.folderId || '').trim();
    var fileName = String(body.fileName || '').trim();
    var mimeType = String(body.mimeType || 'image/jpeg').trim();
    var base64 = String(body.base64 || '').replace(/^data:[^;,]+;base64,/, '');
    if (!folderId || !fileName || !base64) {
      return json_({ ok: false, error: 'MISSING_FIELDS' });
    }

    var folder = DriveApp.getFolderById(folderId);

    // Tạo/tìm các cấp thư mục con (vd: Chi nhánh / 2026-10-31 / Tên NV).
    var segments = body.segments;
    if (segments && segments.length) {
      for (var i = 0; i < segments.length; i++) {
        var seg = String(segments[i] || '').trim();
        if (!seg) continue;
        folder = getOrCreateChildFolder_(folder, seg);
      }
    }

    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(bytes, mimeType, fileName);

    // Ghi đè nếu file cùng tên đã tồn tại (đúng 1 check-in + 1 check-out/ngày).
    var existing = folder.getFilesByName(fileName);
    while (existing.hasNext()) {
      existing.next().setTrashed(true);
    }
    var file = folder.createFile(blob);

    return json_({
      ok: true,
      fileId: file.getId(),
      file_id: file.getId(),
      webViewLink: file.getUrl(),
      web_view_link: file.getUrl(),
      name: file.getName(),
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Tìm thư mục con theo tên, chưa có thì tạo mới. */
function getOrCreateChildFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}
