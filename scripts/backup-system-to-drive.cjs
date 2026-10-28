#!/usr/bin/env node
/**
 * UBM HR SYSTEM - BACKUP TOÀN BỘ HỆ THỐNG VPS LÊN GOOGLE DRIVE
 * ==============================================================
 * Tự động đóng gói cấu hình, biến môi trường, dữ liệu snapshot,
 * mã nguồn và sao chép Google Sheets Master lên thư mục Google Drive.
 * 
 * Target Drive Folder ID mặc định: 15eQ7vLbnhwt5YVrnsOaKi-1jfAENesxR
 * ==============================================================
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TARGET_FOLDER_ID = process.env.BACKUP_DRIVE_FOLDER_ID || '15eQ7vLbnhwt5YVrnsOaKi-1jfAENesxR';
const REPO_ROOT = path.resolve(__dirname, '..');

// 1. Nạp biến môi trường từ apps/backend/.env hoặc .env
const envPaths = [
  path.join(REPO_ROOT, 'apps/backend/.env'),
  path.join(REPO_ROOT, '.env'),
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
  let auth;
  if (serviceAccountJson) {
    let credentials;
    try {
      credentials = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
    } catch {
      credentials = JSON.parse(Buffer.from(serviceAccountJson, 'base64').toString('utf8'));
    }
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } else {
    throw new Error('Thiếu thông tin xác thực Google Service Account (GOOGLE_SERVICE_ACCOUNT_JSON).');
  }

  return google.drive({ version: 'v3', auth });
}

async function main() {
  console.log(`====================================================`);
  console.log(`[Backup] BẮT ĐẦU BACKUP HỆ THỐNG VPS UBM`);
  console.log(`Thời gian: ${new Date().toISOString()}`);
  console.log(`Target Drive Folder ID: ${TARGET_FOLDER_ID}`);
  console.log(`====================================================`);

  const drive = await getDriveClient();

  // Tạo định danh timestamp theo giờ Việt Nam (UTC+7)
  const nowVN = new Date(Date.now() + 7 * 3600 * 1000);
  const stamp = nowVN.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 19);

  // A. BACKUP DỮ LIỆU GOOGLE SHEETS MASTER (NẾU CÓ SPREADSHEET_ID)
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (spreadsheetId) {
    try {
      console.log(`[Backup] Đang sao chép bản snapshot Google Sheets Master (${spreadsheetId})...`);
      const sheetBackupName = `UBM_SHEETS_MASTER_${stamp}`;
      const copyRes = await drive.files.copy({
        fileId: spreadsheetId,
        requestBody: {
          name: sheetBackupName,
          parents: [TARGET_FOLDER_ID],
        },
        fields: 'id, name, createdTime',
        supportsAllDrives: true,
      });
      console.log(`[Backup] ✅ Đã lưu bản sao Sheets: ${copyRes.data.name} (ID: ${copyRes.data.id})`);
    } catch (err) {
      console.warn(`[Backup] ⚠️ Không thể copy Sheets trực tiếp: ${err.message}`);
    }
  }

  // B. ĐÓNG GÓI TOÀN BỘ CẤU HÌNH VÀ DỮ LIỆU VPS THÀNH FILE .TAR.GZ
  const backupFileName = `UBM_VPS_SYSTEM_BACKUP_${stamp}.tar.gz`;
  const tempDir = fs.existsSync('/tmp') ? '/tmp' : (process.env.TEMP || '.');
  const tempArchive = path.join(tempDir, backupFileName);

  console.log(`[Backup] Đang nén các thành phần cốt lõi của VPS vào: ${tempArchive}...`);
  try {
    // Thu thập thêm cấu hình Nginx nếu có
    const nginxConfDir = '/etc/nginx/sites-available';
    const hasNginx = fs.existsSync(nginxConfDir);

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
    console.log(`[Backup] Đang quét và xóa các bản sao lưu cũ quá 30 ngày trong thư mục Drive...`);
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
          console.log(`[Backup] Đã xóa bản sao lưu cũ: ${f.name} (${f.createdTime})`);
          deletedCount++;
        } catch {}
      }
    }
    console.log(`[Backup] Dọn dẹp hoàn tất: đã xóa ${deletedCount} bản sao lưu cũ quá 30 ngày.`);
  } catch (err) {
    console.warn(`[Backup] Cảnh báo dọn dẹp Drive cũ:`, err.message);
  }

  console.log(`====================================================`);
  console.log(`[Backup] HOÀN TẤT SAO LƯU HỆ THỐNG VPS THÀNH CÔNG!`);
  console.log(`====================================================`);
}

main().catch(err => {
  console.error(`[Backup] CHƯƠNG TRÌNH DỪNG VỚI LỖI:`, err);
  process.exit(1);
});
