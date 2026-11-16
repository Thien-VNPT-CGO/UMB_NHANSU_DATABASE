import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsSyncService } from '../src/services/google-sheets-sync.service.js';

/**
 * Regression: backup Google Sheets lên Drive phải hoàn tất kể cả khi
 *
 *  1. Drive API từ chối export 1 bảng vì quá lớn
 *     (403 "This file is too large to be exported." — thực tế gặp với
 *      THONGBAO_NV ~56.000 dòng và THONGBAO_GUI), và
 *  2. OAuth hết hiệu lực (invalid_client) nên không tạo folder/upload được.
 *
 * Trước đây cả 2 trường hợp đều làm ZIP bị bỏ (BACKUP_SHEETS_*_FAILED lặp lại
 * mỗi 5 phút) dù 23/25 bảng export thành công.
 *
 * Nay: bảng quá lớn được export CSV qua Sheets API, ZIP được đẩy lên Drive
 * bằng webhook Apps Script (không cần token).
 */

type Stub = { calls: any[] };

function makeService(): GoogleSheetsSyncService {
  const svc: any = new GoogleSheetsSyncService();
  svc.isConfigured = true;
  return svc;
}

function stubSheetsClient(svc: any, rows: any[][], tabs = ['THONGBAO']) {
  svc.sheetsClient = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: tabs.map(t => ({
            properties: { title: t, gridProperties: { rowCount: rows.length, columnCount: 5 } },
          })),
        },
      }),
      values: {
        get: async () => ({ data: { values: rows } }),
      },
    },
  };
}

function driveError(message: string, code = 403) {
  const err: any = new Error(message);
  err.code = code;
  err.response = { status: code, data: { error: { code, message } } };
  return err;
}

function decodeZipBase64(bodyJson: any): Buffer {
  return Buffer.from(String(bodyJson.base64 || ''), 'base64');
}

/** Liệt kê entry trong ZIP (đọc local file header, tự giải nén DEFLATE). */
function readZipEntries(zip: Buffer): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  let off = 0;
  while (off + 30 <= zip.length && zip.readUInt32LE(off) === 0x04034b50) {
    const method = zip.readUInt16LE(off + 8);
    const packedSize = zip.readUInt32LE(off + 18);
    const nameLen = zip.readUInt16LE(off + 26);
    const extraLen = zip.readUInt16LE(off + 28);
    const name = zip.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    const dataStart = off + 30 + nameLen + extraLen;
    const data = zip.subarray(dataStart, dataStart + packedSize);
    const raw = method === 8 ? require('node:zlib').inflateRawSync(data) : data;
    out.push({ name, text: raw.toString('utf8') });
    off = dataStart + packedSize;
  }
  return out;
}

function entryText(zip: Buffer, suffix: string): string {
  const hit = readZipEntries(zip).find(e => e.name.endsWith(suffix));
  assert.ok(hit, `không thấy entry "${suffix}" trong ZIP: ${readZipEntries(zip).map(e => e.name).join(', ')}`);
  return hit!.text;
}

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('bảng quá lớn (403) vẫn vào ZIP dạng CSV; OAuth hỏng thì upload qua webhook', async () => {
  let capturedBody: any = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    capturedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ ok: true, fileId: 'ZIP_WEBHOOK_1', webViewLink: 'https://drive.example/zip1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  try {
    await withEnv({ GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL: 'https://hook.example/upload', GOOGLE_DRIVE_WEBHOOK_SECRET: undefined }, async () => {
      const svc = makeService() as any;
      stubSheetsClient(svc, [
        ['MA', 'NOI_DUNG'],
        ['TB01', 'Có dấu phẩy, và "ngoặc kép"'],
      ]);
      svc.getServiceAccountDriveClient = async () => null;
      svc.ensureDriveFolderPath = async () => 'FOLDER_DAY_1';
      svc.driveClient = {
        files: {
          // OAuth chết: list/find/export/create đều lỗi
          list: async () => { throw driveError('invalid_client', 401); },
          export: async () => { throw driveError('This file is too large to be exported.', 403); },
          create: async () => { throw driveError('invalid_client', 401); },
        },
      };

      const res = await svc.backupSpreadsheetSetZipTo({
        rootId: 'ROOT_DAY',
        segments: ['2026-11-15'],
        periodKey: '2026-11-15',
        sources: [{ title: 'THONGBAO_NV', spreadsheetId: 'SID_THONGBAO' }],
        keep: 30,
      });

      assert.equal(res.ok, true, `phải thành công, nhận: ${JSON.stringify(res)}`);
      assert.equal(res.exported, 1);
      assert.equal(res.fileId, 'ZIP_WEBHOOK_1');
      assert.equal(res.url, 'https://drive.example/zip1');
      assert.equal(res.name, 'UMB_NHANSU_2026-11-15.zip');

      assert.ok(capturedBody, 'phải gọi webhook upload vì Drive API chết');
      assert.equal(capturedBody.fileName, 'UMB_NHANSU_2026-11-15.zip');
      assert.equal(capturedBody.mimeType, 'application/zip');

      const zip = decodeZipBase64(capturedBody);
      const csv = entryText(zip, 'THONGBAO_NV_2026-11-15__THONGBAO.csv');
      assert.ok(csv.startsWith('\uFEFF'), 'CSV phải có BOM UTF-8 để Excel đọc đúng tiếng Việt');
      assert.ok(csv.includes('"Có dấu phẩy, và ""ngoặc kép"""'), 'CSV phải escape dấu phẩy + ngoặc kép');
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('export XLSX bình thường thì không gọi webhook (giữ nguyên hành vi cũ)', async () => {
  let webhookCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    webhookCalls += 1;
    return new Response(JSON.stringify({ ok: true, fileId: 'SHOULD_NOT_HAPPEN' }), { status: 200 });
  }) as any;

  try {
    await withEnv({ GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL: 'https://hook.example/upload' }, async () => {
      const svc = makeService() as any;
      stubSheetsClient(svc, [['x']]);
      svc.getServiceAccountDriveClient = async () => null;
      svc.ensureDriveFolderPath = async () => 'FOLDER_DAY_1';
      let uploadedZip = Buffer.alloc(0);
      svc.driveClient = {
        files: {
          list: async () => ({ data: { files: [] } }),
          export: async () => ({ data: Buffer.from('PK-FAKE-XLSX') }),
          create: async (params: any) => {
            const chunks: Buffer[] = [];
            for await (const chunk of params.media.body) chunks.push(Buffer.from(chunk));
            uploadedZip = Buffer.concat(chunks);
            return { data: { id: 'ZIP_DRIVE_1', webViewLink: 'https://drive.example/zip-drive' } };
          },
        },
      };

      const res = await svc.backupSpreadsheetSetZipTo({
        rootId: 'ROOT_DAY',
        segments: ['2026-11-15'],
        periodKey: '2026-11-15',
        sources: [{ title: 'PHAN_CONG_CA', spreadsheetId: 'SID_PCC' }],
        keep: 30,
      });

      assert.equal(res.ok, true);
      assert.equal(res.fileId, 'ZIP_DRIVE_1');
      assert.equal(webhookCalls, 0, 'Drive API còn sống thì không được gọi webhook');
      assert.ok(uploadedZip.toString('utf8').includes('PHAN_CONG_CA_2026-11-15.xlsx'));
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('không tạo được folder kỳ và không có webhook -> BACKUP_FOLDER_UNAVAILABLE (không upload rác)', async () => {
  await withEnv({ GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL: undefined }, async () => {
    const svc = makeService() as any;
    stubSheetsClient(svc, [['x']]);
    svc.ensureDriveFolderPath = async () => '';
    svc.driveClient = {
      files: {
        list: async () => ({ data: { files: [] } }),
        export: async () => ({ data: Buffer.from('PK') }),
        create: async () => ({ data: { id: 'X' } }),
      },
    };

    const res = await svc.backupSpreadsheetSetZipTo({
      rootId: 'ROOT_DAY',
      segments: ['2026-11-15'],
      periodKey: '2026-11-15',
      sources: [{ title: 'PHAN_CONG_CA', spreadsheetId: 'SID_PCC' }],
      keep: 30,
    });

    assert.equal(res.ok, false);
    assert.equal(res.reason, 'BACKUP_FOLDER_UNAVAILABLE');
  });
});

test('bảng log vượt giới hạn dòng -> chỉ lấy các dòng mới nhất + ghi chú trong ZIP', async () => {
  let capturedBody: any = null;
  let requestedRange = '';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    capturedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ ok: true, fileId: 'ZIP_TRUNC_1' }), { status: 200 });
  }) as any;

  try {
    await withEnv({
      GOOGLE_DRIVE_UPLOAD_WEBHOOK_URL: 'https://hook.example/upload',
      BACKUP_LOG_MAX_ROWS_PER_SHEET: '20000',
    }, async () => {
      const svc = makeService() as any;
      svc.getServiceAccountDriveClient = async () => null;
      svc.ensureDriveFolderPath = async () => 'FOLDER_DAY_1';
      svc.driveClient = {
        files: {
          list: async () => ({ data: { files: [] } }),
          export: async () => { throw driveError('This file is too large to be exported.', 403); },
          create: async () => { throw driveError('invalid_client', 401); },
        },
      };
      svc.sheetsClient = {
        spreadsheets: {
          get: async () => ({
            data: {
              sheets: [{ properties: { title: 'THONGBAO_NV', gridProperties: { rowCount: 50_000, columnCount: 5 } } }],
            },
          }),
          values: {
            get: async (params: any) => {
              requestedRange = String(params.range || '');
              return { data: { values: [['TB', 'mới nhất']] } };
            },
          },
        },
      };

      const res = await svc.backupSpreadsheetSetZipTo({
        rootId: 'ROOT_DAY',
        segments: ['2026-11-15'],
        periodKey: '2026-11-15',
        sources: [{ title: 'THONGBAO_NV', spreadsheetId: 'SID_NV' }],
        keep: 30,
      });

      assert.equal(res.ok, true, JSON.stringify(res));
      // 50.000 dòng > 20.000 -> đọc từ dòng 30.001 (các dòng mới nhất).
      assert.ok(requestedRange.includes('A30001:'), `phải đọc phần đuôi, nhận: ${requestedRange}`);

      const zipText = entryText(decodeZipBase64(capturedBody), 'THONGBAO_NV_2026-11-15__GHI_CHU.txt');
      assert.ok(zipText.includes('50000') || zipText.includes('50.000'), 'ghi chú phải nêu tổng số dòng');
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});
