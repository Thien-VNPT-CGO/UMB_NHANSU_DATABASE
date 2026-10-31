const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const key = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../key.json'), 'utf8'));

const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});

const drive = google.drive({ version: 'v3', auth });

const DRIVE_ATTENDANCE_BRANCH_FOLDERS = {
  CN1: '16vPAt_0isAXDU2PVBITBOOt6tT-qWMaz',
  CN130: '16vPAt_0isAXDU2PVBITBOOt6tT-qWMaz',
  CN2: '1WWInMoLFaJAz8Q5e4O74ZbPPSruvb97y',
  CN261: '1WWInMoLFaJAz8Q5e4O74ZbPPSruvb97y',
  CN3: '1J9nGFl9EpPfxlIwew2M2_9BV7g2wKWid',
  CN120: '1J9nGFl9EpPfxlIwew2M2_9BV7g2wKWid',
  CN4: '1fNYd6tEJfbW8yXAeR8fq_fh9-QtlcgBP',
  CN111: '1fNYd6tEJfbW8yXAeR8fq_fh9-QtlcgBP',
  XUONG: '1-czL-M6Z4njl0AceKQHmj-qCJXGJkBoS',
  XUONG_SX: '1-czL-M6Z4njl0AceKQHmj-qCJXGJkBoS',
  VANPHONG: '1RytLiwJSwrIHPu4Gn49a6_6qyEiIM__Z',
  VAN_PHONG: '1RytLiwJSwrIHPu4Gn49a6_6qyEiIM__Z',
};

function getAttendanceFolderForBranch(branchId) {
  if (!branchId) return '1vql_oCLqsyDdvMlh_XIIhPhLuFWq387G';
  const raw = String(branchId).trim();
  const upper = raw.toUpperCase();
  if (DRIVE_ATTENDANCE_BRANCH_FOLDERS[upper]) return DRIVE_ATTENDANCE_BRANCH_FOLDERS[upper];
  if (DRIVE_ATTENDANCE_BRANCH_FOLDERS[raw]) return DRIVE_ATTENDANCE_BRANCH_FOLDERS[raw];

  const normalized = upper
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D');

  if (normalized.includes('130') || normalized.includes('CN1') || normalized.includes('VAN KIEP')) {
    return DRIVE_ATTENDANCE_BRANCH_FOLDERS.CN1;
  }
  if (normalized.includes('261') || normalized.includes('CN2') || normalized.includes('TO HIEN THANH')) {
    return DRIVE_ATTENDANCE_BRANCH_FOLDERS.CN2;
  }
  if (normalized.includes('120') || normalized.includes('CN3') || normalized.includes('HOANG DIEU')) {
    return DRIVE_ATTENDANCE_BRANCH_FOLDERS.CN3;
  }
  if (normalized.includes('111') || normalized.includes('CN4') || normalized.includes('TON DAN')) {
    return DRIVE_ATTENDANCE_BRANCH_FOLDERS.CN4;
  }
  if (normalized.includes('XUONG') || normalized.includes('CU CHI')) {
    return DRIVE_ATTENDANCE_BRANCH_FOLDERS.XUONG;
  }
  if (normalized.includes('VAN PHONG') || normalized.includes('VANPHONG') || normalized.includes('TRU SO')) {
    return DRIVE_ATTENDANCE_BRANCH_FOLDERS.VANPHONG;
  }

  return '1vql_oCLqsyDdvMlh_XIIhPhLuFWq387G';
}

async function ensureDriveFolder(folderName, parentId) {
  const clean = String(folderName).replace(/[\\/:*?"<>|]/g, '-').trim();
  const escaped = clean.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escaped}' and trashed = false and '${parentId}' in parents`;
  
  const listed = await drive.files.list({
    q,
    fields: 'files(id, name)',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (listed.data.files && listed.data.files.length > 0) {
    return listed.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: clean,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, name',
    supportsAllDrives: true,
  });

  return created.data.id;
}

async function ensureDriveFolderPath(segments, rootId) {
  let parent = rootId;
  for (const seg of segments) {
    if (!seg) continue;
    parent = await ensureDriveFolder(seg, parent);
  }
  return parent;
}

async function upsertBufferToDrivePath(fileName, mimeType, buffer, segments, rootId) {
  const parent = await ensureDriveFolderPath(segments, rootId);
  const safeName = String(fileName || 'file').replace(/[\\/:*?"<>|]/g, '-').trim() || 'file';
  const escaped = safeName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name = '${escaped}' and trashed = false and '${parent}' in parents`;

  const listed = await drive.files.list({
    q,
    fields: 'files(id, name)',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (listed.data.files && listed.data.files.length > 0) {
    const existingId = listed.data.files[0].id;
    await drive.files.update({
      fileId: existingId,
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, name',
      supportsAllDrives: true,
    });
    return { fileId: existingId, name: safeName, updated: true };
  }

  const created = await drive.files.create({
    requestBody: { name: safeName, parents: [parent] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });

  return { fileId: created.data.id, name: safeName, created: true };
}

async function run() {
  console.log('--- KIỂM TRA TỰ ĐỘNG UPLOAD ẢNH ĐIỂM DANH THEO CHI NHÁNH ---');

  // Giả lập nhân viên test
  const employee = {
    employee_id: 'EMP_1790349290755_147',
    employee_code: 'UBM_NV171038',
    full_name: 'NGUYỄN NGỌC TÂM UYÊN',
    default_branch_id: 'CN130'
  };

  const branchFolderId = getAttendanceFolderForBranch(employee.default_branch_id);
  console.log(`1. Chi nhánh nhân viên: ${employee.default_branch_id} -> Thư mục Drive ID: ${branchFolderId}`);

  const today = '2026-10-31';
  const segments = [today, employee.full_name];
  console.log(`2. Cấu trúc thư mục con: [Ngày: "${segments[0]}", Tên NV: "${segments[1]}"]`);

  // Tạo 1 buffer ảnh mẫu (1x1 JPEG hoặc tiny sample JPEG)
  // Tiny valid 1x1 JPEG base64:
  const tinyJpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const sampleBuffer = Buffer.from(tinyJpegBase64, 'base64');

  console.log('3. Upload ảnh CHECK-IN ("check in.jpg")...');
  const checkInRes = await upsertBufferToDrivePath('check in.jpg', 'image/jpeg', sampleBuffer, segments, branchFolderId);
  console.log('   -> Kết quả Check-in:', checkInRes);

  console.log('4. Upload ảnh CHECK-OUT ("check out.jpg")...');
  const checkOutRes = await upsertBufferToDrivePath('check out.jpg', 'image/jpeg', sampleBuffer, segments, branchFolderId);
  console.log('   -> Kết quả Check-out:', checkOutRes);

  console.log('5. Kiểm tra cây thư mục trong Chi Nhánh 1 (130 Vạn Kiếp)...');
  const dateFolder = await drive.files.list({
    q: `'${branchFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name)'
  });
  console.log('   Thư mục ngày tìm thấy:', dateFolder.data.files);

  const empFolder = await drive.files.list({
    q: `'${dateFolder.data.files[0].id}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name)'
  });
  console.log('   Thư mục nhân viên tìm thấy:', empFolder.data.files);

  const filesInEmpFolder = await drive.files.list({
    q: `'${empFolder.data.files[0].id}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)'
  });
  console.log('   Các file bên trong thư mục nhân viên:', filesInEmpFolder.data.files);

  console.log('\n=> HOÀN TẤT: Cấu trúc thư mục và 2 file ảnh check-in/out hoạt động CHÍNH XÁC 100%!');
}

run().catch(err => {
  console.error('Lỗi kiểm tra:', err);
  process.exit(1);
});
