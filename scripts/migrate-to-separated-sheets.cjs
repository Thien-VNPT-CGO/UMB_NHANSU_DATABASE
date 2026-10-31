#!/usr/bin/env node
/**
 * UBM HR SYSTEM - MIGRATE MASTER DATA TO 25 SEPARATED GOOGLE SHEETS
 * ================================================================
 * Chuyển toàn bộ dữ liệu từ Google Spreadsheet Master cũ (hoặc Candidate Sheet)
 * sang 25 Google Sheets riêng biệt theo ID do người dùng cung cấp.
 * ================================================================
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');

// 1. Nạp service account
let keyPath = path.join(REPO_ROOT, 'key.json');
if (!fs.existsSync(keyPath)) {
  keyPath = path.join(REPO_ROOT, 'apps/backend/key.json');
}
if (!fs.existsSync(keyPath)) {
  console.error('[Migration] Không tìm thấy file key.json!');
  process.exit(1);
}

const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
});

const sheets = google.sheets({ version: 'v4', auth });

const OLD_MASTER_SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1UO1UF1d7_YzaCltYt2m9pRnUauGWw873ERqAMxwL-6k';
const CANDIDATE_SPREADSHEET_ID = process.env.CANDIDATE_SPREADSHEET_ID || '1rcqEKraSRhr-Tn9qwlhADlkQUei8j65bXeHF_Tmkd38';

const NEW_SHEETS_MAP = {
  FROM_NHAN_VIEN: '1kBpYSBKT-UQhTRzOU_38lZ34B78ZrzErDgydC5pubY8',
  NHAN_VIEN_MASTER: '1XvASWXUqltONLwvV1m2PIdi7BtRYZbyW-BYZj00xUsQ',
  PHAN_CONG_CA: '1pLbQxCWQthwhcSo2MJmGAWS_pZPisyEpWeImc0p0l0Q',
  TAI_KHOAN_NHAN_VIEN: '1Mr-ux8IWMKa4vqUgWo55wyDLO1wfMlycPH17mltOeZQ',
  SU_KIEN_DIEM_DANH: '1n8zK3R7ZS8WV2wdLBmDegrxe6qKkRk6NDn3skKKZ374',
  DON_NGHI_PHEP: '1pvsdb4-im6Gz-MGTWX6CK3FQg_EPxvdu_77njFTzHLc',
  DON_DOI_CA: '1sfMrfPv6enH9_OTTZMwX98tL7CX2lRNh91LUMwkpl_U',
  THONGBAO_NV: '13hUNoKT8U1Li_EIyx3bxNGQaiuVvsiXY_ussblJpWRE',
  DIEU_CHINH_CONG: '1zixbn7FSqvEALYTOsG5dZttT2Wf6w4zIvjPuz1NuBL0',
  KY_LUONG: '13kwbYcXQ9SsNs6hlpB5BmAx8pdO-xLT1qsrRdU8xaA0',
  CHI_TIET_LUONG: '1Kwnto75bUxlMsWGGxTYVqFq3I7Ty0nik6JL90_dIFY0',
  AUDIT_LOG: '1PPJZPjaCMC4_17nQItZgdN5Jq0ILtdZgi0ZJawmXtLg',
  DANH_SACH_CHI_NHANH: '1b5EdX23uZQw9RtmBEPqFKvd9R2qkLbfrjNO7c8R32So',
  ADMIN_ACCOUNTS: '1z0Gu7JrK7mdNMu4N-WmMt3HTaKA56DM3_LY_9QRSSXU',
  CAU_HINH_HE_THONG: '1JcJsEMBhS_RQR68prdTvDtsdn0ONgKxO_4U-04Pvpdo',
  BAI_THI: '1aomZUt7YYy4J2fUjHavVJdcrcaTNWmjOSIh-qJlgQ64',
  BAI_LAM: '1YypwqMcwKUT_CU86UmUvb8oXmGUPi9HhFGG1ykSJ-Js',
  LUUTRU_CHAMCONG_TUAN: '159EMCALHp1b_WmiprHmkrgDq6peAyP0NEkQ729aSUZM',
  PHIEU_LUONG: '1aRZ2IL2z3yqQYr1YKEI1SSdJG4VRrqyzaz9KKW8kI10',
  LICH_SU_GIAI_DOAN: '1FA0sIFNGP8L7Jb6tVHFt043s11m83KC1tCp38XaJDYc',
  CONG_THUC_LUONG: '1YptJQybfT7FXxcrJaR_FFak8fPUDLTe4YQgYH7RBY-s',
  DULIEU_LUONG_KY: '1i-vnz5L1errwNE7y1PqYdVzaF1oMFOD0C-IRRdCzzYY',
  THONGBAO_GUI: '12lTHxPn80hOnLNE8fvNno08tURZfqvPPhiOeFzS47p8',
  SNAPSHOT_SAOLUU: '10CYuaiPqWwbTfWBCw9JGXCjcBzzwZUtpBnOP5NuzZpQ',
  PHIEU_NV_CAP_NHAT_CA: '1ZtR2jm8xYeh3P08ipSkG0BTJfqzerU7EMJVJFxeLr_U',
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retryCall(fn, maxRetries = 5, delayMs = 3000) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isRateLimit = err?.code === 429 || err?.message?.includes('Quota') || err?.message?.includes('Rate Limit');
      if (attempt >= maxRetries || (!isRateLimit && attempt >= 3)) {
        throw err;
      }
      const backoff = isRateLimit ? delayMs * Math.pow(2, attempt) : delayMs;
      console.warn(`[Retry] Lần ${attempt}/${maxRetries} thất bại (${err.message}), chờ ${backoff}ms...`);
      await sleep(backoff);
    }
  }
}

async function main() {
  console.log('===============================================================');
  console.log('BẮT ĐẦU CHUYỂN DỮ LIỆU SANG 25 GOOGLE SHEETS RIÊNG BIỆT');
  console.log(`Service Account: ${key.client_email}`);
  console.log(`Master Nguồn: ${OLD_MASTER_SPREADSHEET_ID}`);
  console.log(`Tổng số bảng cần chuyển: ${Object.keys(NEW_SHEETS_MAP).length}`);
  console.log('===============================================================\n');

  // BƯỚC 1: Đọc toàn bộ dữ liệu nguồn từ Master cũ trong 1 đợt batchGet
  const filterArgs = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const tabNames = filterArgs.length > 0
    ? filterArgs.filter(t => NEW_SHEETS_MAP[t])
    : Object.keys(NEW_SHEETS_MAP);

  console.log(`>>> Bước 1: Đang nạp toàn bộ dữ liệu ${tabNames.length} tabs từ Master cũ (batchGet)...`);
  const t0 = Date.now();

  const dataByTab = {};

  try {
    const batchRes = await retryCall(() =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: OLD_MASTER_SPREADSHEET_ID,
        ranges: tabNames.map(t => `'${t}'!A1:AZ`),
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      })
    );

    const valueRanges = batchRes.data.valueRanges || [];
    for (let i = 0; i < tabNames.length; i++) {
      const name = tabNames[i];
      dataByTab[name] = valueRanges[i]?.values || [];
      console.log(`  - Tab [${name}]: ${dataByTab[name].length} dòng.`);
    }
    console.log(`>>> Nạp toàn bộ dữ liệu thành công trong ${Math.round((Date.now() - t0) / 1000)}s!\n`);
  } catch (err) {
    console.error('Lỗi khi batchGet từ Master cũ:', err.message);
    throw err;
  }

  // Riêng tab FROM_NHAN_VIEN, nếu trong candidate spreadsheet có dữ liệu nhiều hơn, lấy thêm
  try {
    const candRes = await sheets.spreadsheets.values.get({
      spreadsheetId: CANDIDATE_SPREADSHEET_ID,
      range: `'FROM_NHAN_VIEN'!A1:ZZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const candRows = candRes.data.values || [];
    if (candRows.length > (dataByTab['FROM_NHAN_VIEN'] || []).length) {
      console.log(`>>> Ưu tiên nạp ${candRows.length} dòng FROM_NHAN_VIEN từ CANDIDATE_SPREADSHEET_ID.`);
      dataByTab['FROM_NHAN_VIEN'] = candRows;
    }
  } catch (err) {
    console.warn('Bỏ qua kiểm tra candidate sheet phụ:', err.message);
  }

  // BƯỚC 2: Ghi dữ liệu vào từng Sheet đích
  console.log('\n>>> Bước 2: Bắt đầu ghi dữ liệu sang từng Google Sheet đích...');
  const summary = [];

  for (let idx = 0; idx < tabNames.length; idx++) {
    const tabTitle = tabNames[idx];
    const targetId = NEW_SHEETS_MAP[tabTitle];
    const rows = dataByTab[tabTitle] || [];

    console.log(`\n---------------------------------------------------------------`);
    console.log(`[${idx + 1}/${tabNames.length}] Xử lý: ${tabTitle} (${rows.length} dòng) -> Sheet ID: ${targetId}`);

    try {
      // 1. Lấy thông tin Sheet đích
      const meta = await retryCall(() =>
        sheets.spreadsheets.get({
          spreadsheetId: targetId,
        })
      );

      const firstSheet = meta.data.sheets?.[0];
      const firstSheetId = firstSheet?.properties?.sheetId ?? 0;
      const currentTitle = firstSheet?.properties?.title ?? 'Trang tính1';

      // 2. Đổi tên tab đầu tiên thành tabTitle & Freeze dòng tiêu đề & Mở rộng số dòng (rowCount)
      const requests = [];
      if (currentTitle !== tabTitle) {
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: firstSheetId,
              title: tabTitle,
            },
            fields: 'title',
          },
        });
      }

      // Mở rộng kích thước bảng (rowCount) nếu số dòng cần ghi lớn hơn kích thước hiện tại
      const neededRows = Math.max(1000, rows.length + 100);
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId: firstSheetId,
            gridProperties: {
              rowCount: neededRows,
              frozenRowCount: 1,
            },
          },
          fields: 'gridProperties.rowCount,gridProperties.frozenRowCount',
        },
      });

      await retryCall(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId: targetId,
          requestBody: { requests },
        })
      );

      // 3. Clear nội dung cũ
      await retryCall(() =>
        sheets.spreadsheets.values.clear({
          spreadsheetId: targetId,
          range: `'${tabTitle}'!A1:AZ`,
        })
      );

      // 4. Ghi dữ liệu mới (theo chunks 2500 dòng)
      if (rows.length > 0) {
        const CHUNK_SIZE = 2500;
        const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);

        for (let c = 0; c < totalChunks; c++) {
          const start = c * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, rows.length);
          const chunk = rows.slice(start, end);
          const rowNum = start + 1;

          await retryCall(() =>
            sheets.spreadsheets.values.update({
              spreadsheetId: targetId,
              range: `'${tabTitle}'!A${rowNum}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: chunk },
            })
          );

          if (totalChunks > 1) {
            console.log(`  + Đã ghi chunk ${c + 1}/${totalChunks} (dòng ${rowNum}..${end})`);
            await sleep(1200);
          }
        }
      }

      console.log(`✅ [${tabTitle}] Thành công chuyển ${rows.length} dòng sang Sheet đích!`);
      summary.push({ Tab: tabTitle, TargetID: targetId, Rows: rows.length, Status: 'SUCCESS' });

      // Nghỉ 1.5s giữa các sheet để giữ nhịp API luôn an toàn dưới 60 writes/min
      await sleep(1500);
    } catch (err) {
      console.error(`❌ [${tabTitle}] Lỗi chuyển dữ liệu:`, err.message);
      summary.push({ Tab: tabTitle, TargetID: targetId, Rows: rows.length, Status: 'FAILED', Error: err.message });
      await sleep(2000);
    }
  }

  console.log('\n===============================================================');
  console.log('TỔNG KẾT KẾT QUẢ CHUYỂN DỮ LIỆU SANG 25 SHEETS:');
  console.log('===============================================================');
  console.table(summary);

  const failed = summary.filter(s => s.Status === 'FAILED');
  if (failed.length === 0) {
    console.log('\n🎉 TẤT CẢ 25 SHEETS ĐÃ ĐƯỢC CHUYỂN DỮ LIỆU THÀNH CÔNG RỰC RỠ 100%!');
  } else {
    console.log(`\n⚠️ Có ${failed.length} sheet bị lỗi, vui lòng kiểm tra bảng tổng kết.`);
  }
}

main().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
