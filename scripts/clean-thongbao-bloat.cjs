const { google } = require('googleapis');
const key = require('../key.json');

const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = '1UO1UF1d7_YzaCltYt2m9pRnUauGWw873ERqAMxwL-6k';
const thongbaoSheetId = 1855517582;

async function run() {
  console.log('1. Reading last 500 rows from THONGBAO_NV...');
  const tail = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'THONGBAO_NV!A693549:Z694049'
  });

  const savedRows = tail.data.values || [];
  console.log(`Saved ${savedRows.length} recent rows.`);

  console.log('2. Clearing THONGBAO_NV!A2:Z...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'THONGBAO_NV!A2:Z'
  });

  if (savedRows.length > 0) {
    console.log('3. Writing saved recent rows back to THONGBAO_NV!A2...');
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `THONGBAO_NV!A2:Z${savedRows.length + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: savedRows }
    });
  }

  const newRowCount = Math.max(1000, savedRows.length + 10);
  console.log(`4. Trimming THONGBAO_NV grid from row ${newRowCount} to 694049...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: thongbaoSheetId,
              dimension: 'ROWS',
              startIndex: newRowCount,
              endIndex: 694049
            }
          }
        }
      ]
    }
  });

  console.log('5. Fixing duplicate row in DIEU_CHINH_CONG...');
  const adjRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'DIEU_CHINH_CONG!A1:N20'
  });
  const adjRows = adjRes.data.values || [];
  const seenAdj = new Set();
  const cleanAdj = [];
  cleanAdj.push(adjRows[0]); // Header
  for (let i = 1; i < adjRows.length; i++) {
    const row = adjRows[i];
    const id = row[0];
    if (id && !seenAdj.has(id)) {
      seenAdj.add(id);
      cleanAdj.push(row);
    }
  }
  console.log(`DIEU_CHINH_CONG deduplicated: ${adjRows.length} -> ${cleanAdj.length}`);
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'DIEU_CHINH_CONG!A1:N20'
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `DIEU_CHINH_CONG!A1:N${cleanAdj.length}`,
    valueInputOption: 'RAW',
    requestBody: { values: cleanAdj }
  });

  console.log('ALL CLEANUP COMPLETE!');
}

run().catch(console.error);
