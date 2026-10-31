const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const key = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../key.json'), 'utf8'));

const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/drive']
});

const drive = google.drive({ version: 'v3', auth });

async function checkFolder() {
  const targetId = process.argv[2] || '16vPAt_0isAXDU2PVBITBOOt6tT-qWMaz';
  const listRes = await drive.files.list({
    q: `'${targetId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  console.log(`\nFolder (${targetId}) has ${listRes.data.files.length} items:`);
  listRes.data.files.forEach(item => console.log(`  * ${item.name} (${item.id}, ${item.mimeType})`));
}

checkFolder();
