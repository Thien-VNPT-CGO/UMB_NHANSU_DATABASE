import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildZipStore, crc32 } from '../src/utils/zip-store.js';

/**
 * Regression: entry CSV/JSON có thể bật DEFLATE (`compress: true`).
 *
 * Backup 25 bảng Google Sheets phải nhét 2 bảng log lớn dưới dạng CSV; nếu để
 * STORE thì ZIP lên tới hàng chục MB và webhook Apps Script trả HTTP 400
 * (payload quá lớn). Nén DEFLATE giảm 5–15 lần, ZIP còn vài MB.
 */

function readFirstLocalEntry(zip: Buffer) {
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'phải là local file header');
  const method = zip.readUInt16LE(8);
  const crc = zip.readUInt32LE(14);
  const packedSize = zip.readUInt32LE(18);
  const rawSize = zip.readUInt32LE(22);
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const name = zip.subarray(30, 30 + nameLen).toString('utf8');
  const dataStart = 30 + nameLen + extraLen;
  const data = zip.subarray(dataStart, dataStart + packedSize);
  return { method, crc, packedSize, rawSize, name, data };
}

test('entry compress:true dùng DEFLATE và giải nén đúng nội dung gốc', () => {
  const rows: string[] = ['MA,NOI_DUNG,THOI_GIAN'];
  for (let i = 0; i < 2000; i += 1) {
    rows.push(`TB${String(i).padStart(5, '0')},"Thông báo số ${i}",2026-11-16 08:00:00`);
  }
  const original = Buffer.from(rows.join('\r\n'), 'utf8');

  const zip = buildZipStore([{ name: 'THONGBAO_NV_2026-11-15__THONGBAO.csv', data: original, compress: true }]);
  const entry = readFirstLocalEntry(zip);

  assert.equal(entry.name, 'THONGBAO_NV_2026-11-15__THONGBAO.csv');
  assert.equal(entry.method, 8, 'phải đánh dấu method DEFLATE (8)');
  assert.equal(entry.rawSize, original.length);
  assert.equal(entry.crc, crc32(original));
  assert.ok(entry.packedSize < original.length / 3, 'CSV lặp lại phải nén còn dưới 1/3');
  assert.equal(zlib.inflateRawSync(entry.data).toString('utf8'), original.toString('utf8'));
});

test('mặc định (không compress) vẫn là STORE — ảnh/XLSX không bị nén lại', () => {
  const original = Buffer.from('PK\u0003\u0004 binary-ish payload', 'utf8');
  const zip = buildZipStore([{ name: 'PHAN_CONG_CA_2026-11-15.xlsx', data: original }]);
  const entry = readFirstLocalEntry(zip);

  assert.equal(entry.method, 0, 'mặc định phải giữ STORE (0)');
  assert.equal(entry.packedSize, original.length);
  assert.deepEqual(Buffer.from(entry.data), original);
});
