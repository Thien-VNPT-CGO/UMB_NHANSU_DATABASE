const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const key = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../key.json'), 'utf8'));
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/drive']
});
const drive = google.drive({ version: 'v3', auth });

async function createBackupHourFolder() {
  const rootId = '1tBbooiPlppJV8QrpY2gtm8ij6FUf-k0j';
  const list = await drive.files.list({
    q: `'${rootId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name)'
  });
  console.log('Existing folders under UMBOMILK_DATABASE:');
  list.data.files.forEach(f => console.log(`  - ${f.name} (${f.id})`));

  const existing = list.data.files.find(f => f.name.includes('HOUR') || f.name.includes('15MIN'));
  if (existing) {
    console.log(`\n=> Folder BACKUP_DATA_HOUR đã tồn tại: ${existing.name} (${existing.id})`);
    return existing.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: 'BACKUP_DATA_HOUR',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootId]
    },
    fields: 'id, name',
    supportsAllDrives: true
  });
  console.log(`\n=> Đã tạo folder mới: ${created.data.name} (ID: ${created.data.id})`);
  return created.data.id;
}

createBackupHourFolder().catch(err => {
  console.error('Lỗi:', err);
  process.exit(1);
});
