#!/usr/bin/env node
/**
 * UBM HR SYSTEM - BACKUP TOÀN BỘ HỆ THỐNG VPS LÊN GOOGLE DRIVE
 * ==============================================================
 * Tự động đóng gói cấu hình, biến môi trường, dữ liệu snapshot, mã nguồn
 * và sao chép TOÀN BỘ 25 Google Sheets riêng (database đã tách bảng) lên Drive.
 *
 * KHÔNG còn dùng file tổng hợp UMB_NHANSU_DATABASE
 * (1UO1UF1d7_YzaCltYt2m9pRnUauGWw873ERqAMxwL-6k) làm nguồn backup.
 *
 * Cấu trúc mỗi kỳ: <thư mục gốc>/<kỳ>/<TÊN_BẢNG>_<kỳ>
 *   VD: 01. BACKUP_DATA_DAY/2026-11-01/NHAN_VIEN_MASTER_2026-11-01
 *
 * Target Drive Folder ID mặc định: 1GaPSvNcbINMtG90aQ-KzL2SPLxUG9JkG
 * (01. BACKUP_DATA_DAY bên trong UMBOMILK_DATABASE)
 * ==============================================================
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 4 Thư mục Backup tương ứng trên Google Drive (UMBOMILK_DATABASE)
const BACKUP_FOLDERS = {
  hour: '1D4GXSI1P_MUGugrsNJuphYP_VlGylYW6',    // BACKUP_DATA_HOUR (15 phút/lần)
  hourly: '1D4GXSI1P_MUGugrsNJuphYP_VlGylYW6',
  day: '1GaPSvNcbINMtG90aQ-KzL2SPLxUG9JkG',     // 01. BACKUP_DATA_DAY (2h00 sáng mỗi ngày)
  daily: '1GaPSvNcbINMtG90aQ-KzL2SPLxUG9JkG',
  week: '1MoVP66cmDcFLg5Du0WhoQwF9rECqr8z0',    // 02. BACKUP_DATA_WEEK (2h00 sáng Chủ Nhật)
  weekly: '1MoVP66cmDcFLg5Du0WhoQwF9rECqr8z0',
  month: '1fBz9Szu6qCiV086YyxNBSGcjRPXKFddJ',   // 03. BACKUP_DATA_MONTH (2h00 sáng ngày cuối tháng)
  monthly: '1fBz9Szu6qCiV086YyxNBSGcjRPXKFddJ',
};

// Đọc tham số dòng lệnh --type=hour|day|week|month (mặc định là day)
const typeArg = (process.argv.find(a => a.startsWith('--type=')) || '').replace('--type=', '').toLowerCase() || 'day';
const selectedTier = BACKUP_FOLDERS[typeArg] ? typeArg : 'day';
const TARGET_FOLDER_ID = process.env.BACKUP_DRIVE_FOLDER_ID || BACKUP_FOLDERS[selectedTier];
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Đọc danh sách 25 bảng riêng từ config/sheets-mapping.ts.
 * Database đã tách thành từng spreadsheet riêng — file tổng hợp không còn dùng.
 */
function loadSeparatedSheets() {
  const candidates = [
    path.join(REPO_ROOT, 'apps/backend/src/config/sheets-mapping.ts'),
    '/ubm-vps/apps/backend/src/config/sheets-mapping.ts',
    '/root/ubm-vps/apps/backend/src/config/sheets-mapping.ts',
  ];
  const file = candidates.find(p => fs.existsSync(p));
  if (!file) {
    console.error('[Backup] LỖI: Không tìm thấy apps/backend/src/config/sheets-mapping.ts');
    process.exit(1);
  }
  const src = fs.readFileSync(file, 'utf8');
  const map = {};
  const re = /^\s{2}([A-Z0-9_]+):\s*'([A-Za-z0-9_-]+)'\s*,?\s*$/gm;
  let m;
  while ((m = re.exec(src)) !== null) map[m[1]] = m[2];
  const sources = Object.entries(map).map(([title, spreadsheetId]) => ({ title, spreadsheetId }));
  if (sources.length === 0) {
    console.error(`[Backup] LỖI: Không đọc được danh sách bảng từ ${file}`);
    process.exit(1);
  }
  console.log(`[Backup] Đã nạp ${sources.length} bảng riêng từ: ${file}`);
  return sources;
}

// 1. Nạp biến môi trường từ apps/backend/.env hoặc các vị trí trên VPS
const envPaths = [
  path.join(REPO_ROOT, 'apps/backend/.env'),
  path.join(REPO_ROOT, '.env'),
  '/ubm-vps/apps/backend/.env',
  '/root/ubm-vps/apps/backend/.env',
  path.join(process.env.HOME || '', 'ubm-vps/apps/backend/.env'),
];

for (const p of envPaths) {
  if (fs.existsSync(p)) {
    try {
      const content = fs.readFileSync(p, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eq = trimmed.indexOf('=');
        if (eq !== -1) {
          const k = trimmed.slice(0, eq).trim();
          let v = trimmed.slice(eq + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (!process.env[k]) process.env[k] = v;
        }
      });
      console.log(`[Backup] Đã nạp cấu hình từ: ${p}`);
      break;
    } catch {}
  }
}

// 2. Tìm khóa Google Service Account
let serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  const keyCandidates = [
    path.join(REPO_ROOT, 'key.json'),
    path.join(REPO_ROOT, 'data/service-account.json'),
    path.join(REPO_ROOT, 'apps/backend/key.json'),
    '/ubm-vps/key.json',
    '/ubm-vps/data/service-account.json',
    '/root/ubm-vps/key.json',
  ];
  for (const kp of keyCandidates) {
    if (fs.existsSync(kp)) {
      try {
        serviceAccountJson = fs.readFileSync(kp, 'utf8');
        console.log(`[Backup] Đã nạp Service Account key từ: ${kp}`);
        break;
      } catch {}
    }
  }
}

// 3. Khởi tạo Google Drive API
let googleapis;
try {
  googleapis = require('googleapis');
} catch {
  try {
    googleapis = require(path.join(REPO_ROOT, 'apps/backend/node_modules/googleapis'));
  } catch (err) {
    console.error('[Backup] LỖI: Không tìm thấy thư viện googleapis trong node_modules.');
    process.exit(1);
  }
}

const { google } = googleapis;

async function getDriveClient() {
  // Ưu tiên OAuth (giống backend): file/thư mục Drive thuộc tài khoản umbomilk@gmail.com.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth });
  }

  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (serviceAccountJson) {
    let credentials;
    try {
      credentials = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
    } catch {
      credentials = JSON.parse(Buffer.from(serviceAccountJson, 'base64').toString('utf8'));
    }
    email = credentials.client_email;
    privateKey = credentials.private_key;
  }

  if (!email || !privateKey) {
    throw new Error('Thiếu thông tin xác thực Google (OAuth refresh token hoặc Service Account).');
  }

  const formattedKey = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;

  const auth = new google.auth.JWT({
    email,
    key: formattedKey,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });

  return google.drive({ version: 'v3', auth });
}

/** Kỳ backup theo giờ Việt Nam — khớp lịch của backend. */
function resolveSlotKey(tier, vnDate) {
  const pad = n => String(n).padStart(2, '0');
  const d = vnDate;
  if (tier === 'week' || tier === 'weekly') {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${pad(week)}`;
  }
  if (tier === 'month' || tier === 'monthly') {
    const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}`;
  }
  const yest = new Date(d.getTime() - 86400000);
  return `${yest.getUTCFullYear()}-${pad(yest.getUTCMonth() + 1)}-${pad(yest.getUTCDate())}`;
}

async function ensureFolder(drive, parentId, name) {
  const q = `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents`
    + ` and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await drive.files.list({
    q,
    fields: 'files(id,name)',
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const found = res.data.files?.[0];
  if (found?.id) return found.id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}

/** Copy 25 bảng riêng vào folder kỳ. Idempotent theo tên file. */
async function backupSeparatedSheets(drive, folderId, slotKey, sources) {
  const existing = new Set();
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files || []) existing.add(f.name);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  let copied = 0;
  let skipped = 0;
  const errors = [];
  for (const src of sources) {
    const name = `${src.title}_${slotKey}`;
    if (existing.has(name)) { skipped += 1; continue; }
    try {
      await drive.files.copy({
        fileId: src.spreadsheetId,
        requestBody: { name, parents: [folderId] },
        fields: 'id,name',
        supportsAllDrives: true,
      });
      copied += 1;
      console.log(`[Backup]   + ${name}`);
    } catch (err) {
      errors.push({ title: src.title, error: err.message });
      console.warn(`[Backup]   ⚠ ${name}: ${err.message}`);
    }
  }

  console.log(`[Backup] Bảng: ${copied} copy mới, ${skipped} đã có, ${errors.length} lỗi / ${sources.length} tổng.`);
  if (errors.length > 0) throw new Error(`Copy lỗi ${errors.length}/${sources.length} bảng`);
}

async function main() {
  console.log(`====================================================`);
  console.log(`[Backup] BẮT ĐẦU SAO LƯU HỆ THỐNG VPS UBM`);
  console.log(`Thời gian: ${new Date().toISOString()}`);
  console.log(`Target Drive Folder ID: ${TARGET_FOLDER_ID}`);
  console.log(`====================================================`);

  const drive = await getDriveClient();

  // Tạo định danh timestamp theo giờ Việt Nam (UTC+7)
  const nowVN = new Date(Date.now() + 7 * 3600 * 1000);
  const stamp = nowVN.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 19);
  const slotKey = resolveSlotKey(selectedTier, nowVN);

  // A. BACKUP 25 GOOGLE SHEETS RIÊNG (database đã tách bảng)
  //    KHÔNG copy file tổng hợp UMB_NHANSU_DATABASE nữa.
  try {
    const sources = loadSeparatedSheets();
    console.log(`[Backup] Kỳ ${slotKey}: tạo/kiểm tra folder trên Drive...`);
    const folderId = await ensureFolder(drive, TARGET_FOLDER_ID, slotKey);
    console.log(`[Backup] Folder kỳ: https://drive.google.com/drive/folders/${folderId}`);
    await backupSeparatedSheets(drive, folderId, slotKey, sources);
    console.log(`[Backup] ✅ Đã backup ${sources.length} bảng vào kỳ ${slotKey}.`);
  } catch (err) {
    console.error(`[Backup] ❌ Lỗi backup 25 bảng: ${err.message}`);
    throw err;
  }

  // B. ĐÓNG GÓI TOÀN BỘ CẤU HÌNH VÀ DỮ LIỆU VPS THÀNH FILE .TAR.GZ
  const backupFileName = `UBM_VPS_SYSTEM_BACKUP_${stamp}.tar.gz`;
  const tempDir = fs.existsSync('/tmp') ? '/tmp' : (process.env.TEMP || '.');
  const tempArchive = path.join(tempDir, backupFileName);

  console.log(`[Backup] Đang nén các thành phần cốt lõi của VPS vào: ${tempArchive}...`);
  try {
    const tarCmd = [
      'tar',
      '-czf',
      `"${tempArchive}"`,
      '--exclude="node_modules"',
      '--exclude=".git/objects"',
      '--exclude="*.log"',
      '--exclude="dist"',
      '--exclude="coverage"',
      '-C',
      `"${REPO_ROOT}"`,
      '.',
    ];

    execSync(tarCmd.join(' '), { stdio: 'inherit' });

    const stats = fs.statSync(tempArchive);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`[Backup] ✅ Đã nén thành công (${sizeMB} MB). Bắt đầu upload lên Google Drive...`);

    // Upload file nén lên Google Drive
    const uploadRes = await drive.files.create({
      requestBody: {
        name: backupFileName,
        parents: [TARGET_FOLDER_ID],
        description: `Bản sao lưu toàn bộ hệ thống VPS UBM lúc ${nowVN.toISOString()}`,
      },
      media: {
        mimeType: 'application/gzip',
        body: fs.createReadStream(tempArchive),
      },
      fields: 'id, name, size, createdTime',
      supportsAllDrives: true,
    });

    console.log(`[Backup] ✅ TẢI LÊN DRIVE THÀNH CÔNG!`);
    console.log(`Tên file: ${uploadRes.data.name}`);
    console.log(`File ID: ${uploadRes.data.id}`);

    // Xóa file nén tạm trên VPS
    try {
      fs.unlinkSync(tempArchive);
      console.log(`[Backup] Đã dọn dẹp file nén tạm trên VPS.`);
    } catch {}

  } catch (err) {
    console.error(`[Backup] ❌ Lỗi trong quá trình nén hoặc upload file VPS:`, err);
    throw err;
  }

  // C. DỌN DẸP BẢN SAO LƯU CŨ QUÁ HẠN (MẶC ĐỊNH GIỮ 30 NGÀY TRÊN DRIVE)
  try {
    console.log(`[Backup] Đang quét các bản sao lưu cũ trong thư mục Drive...`);
    const cutoffMs = Date.now() - 30 * 86400 * 1000;
    const listRes = await drive.files.list({
      q: `'${TARGET_FOLDER_ID}' in parents and trashed = false and (name contains 'UBM_VPS_SYSTEM_BACKUP_' or name contains 'UBM_SHEETS_MASTER_')`,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime desc',
      pageSize: 100,
      supportsAllDrives: true,
    });

    const files = listRes.data.files || [];
    let deletedCount = 0;
    for (const f of files) {
      if (new Date(f.createdTime).getTime() < cutoffMs) {
        try {
          await drive.files.delete({ fileId: f.id, supportsAllDrives: true });
          console.log(`[Backup] Đã xóa bản sao lưu cũ quá hạn: ${f.name}`);
          deletedCount++;
        } catch {}
      }
    }
    if (deletedCount > 0) {
      console.log(`[Backup] Đã xóa ${deletedCount} bản sao lưu cũ quá 30 ngày.`);
    } else {
      console.log(`[Backup] Không có bản sao lưu nào quá hạn 30 ngày.`);
    }
  } catch (err) {
    console.warn(`[Backup] Cảnh báo dọn dẹp Drive cũ:`, err.message);
  }

  console.log(`====================================================`);
  console.log(`[Backup] HOÀN TẤT SAO LƯU HỆ THỐNG LÊN GOOGLE DRIVE!`);
  console.log(`====================================================`);
}

main().catch(err => {
  console.error(`[Backup] CHƯƠNG TRÌNH DỪNG VỚI LỖI:`, err);
  process.exit(1);
});
