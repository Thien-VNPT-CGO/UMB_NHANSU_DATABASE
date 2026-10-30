const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const key = require('../key.json');

const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = '1UO1UF1d7_YzaCltYt2m9pRnUauGWw873ERqAMxwL-6k';

async function main() {
  const adminHash = bcrypt.hashSync('Master@@2027', 12);
  const hrHash = bcrypt.hashSync('Umbomilk@2027', 12);
  const finHash = bcrypt.hashSync('Umbomilk@2027', 12);

  const cleanRows = [
    [
      'ADM_001',
      'admin',
      adminHash,
      'Quản Trị Viên Hệ Thống',
      'ADMIN',
      '*',
      'ACTIVE',
      '2026-09-25T00:00:00.000Z'
    ],
    [
      'ADM_002',
      'umbomilk-hr',
      hrHash,
      'HR Ụm Bò Milk',
      'HR',
      '*',
      'ACTIVE',
      '2026-09-26T07:53:01.786Z'
    ],
    [
      'ADM_003',
      'finance',
      finHash,
      'Kế Toán Ụm Bò Milk',
      'FINANCE',
      '*',
      'ACTIVE',
      '2026-09-29T08:40:32.732Z'
    ]
  ];

  console.log('Clearing old rows...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'ADMIN_ACCOUNTS!A2:H50'
  });

  console.log('Writing clean accounts...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'ADMIN_ACCOUNTS!A2:H4',
    valueInputOption: 'RAW',
    requestBody: { values: cleanRows }
  });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'ADMIN_ACCOUNTS!A1:H10'
  });
  console.log('Updated rows:', res.data.values);
}

main().catch(console.error);
