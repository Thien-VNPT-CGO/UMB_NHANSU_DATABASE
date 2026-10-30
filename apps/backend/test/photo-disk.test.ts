import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Ảnh đệm VPS (photo-disk.store):
 *  - Lưu/đọc/xóa ảnh chấm công + bằng chứng điều chỉnh.
 *  - Dọn sau backup tháng: chỉ xóa file CŨ HƠN mốc ngày và KHÔNG nằm trong
 *    danh sách "giữ" (ảnh chưa chắc đã lên Drive) — tránh mất ảnh oan.
 */
test('photo-disk: lưu/đọc/xóa + dọn ảnh cũ an toàn', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-photo-'));
  process.env.ATTENDANCE_PHOTO_DIR = dir;
  const store = await import('../src/services/photo-disk.store.js');
  try {
    // --- Lưu / đọc / xóa ---
    const dataUrl = 'data:image/jpeg;base64,' + Buffer.from('abc').toString('base64');
    store.saveAttendancePhotoDisk('EVT_1', dataUrl);
    store.saveAdjustmentPhotoDisk('ADJ_1', dataUrl);
    assert.equal(store.readAttendancePhotoDisk('EVT_1')?.buffer.toString(), 'abc');
    assert.equal(store.readAdjustmentPhotoDisk('ADJ_1')?.buffer.toString(), 'abc');
    assert.equal(store.deleteAttendancePhotoDisk('EVT_1'), true);
    assert.equal(store.deleteAdjustmentPhotoDisk('ADJ_1'), true);
    assert.equal(store.readAttendancePhotoDisk('EVT_1'), null);
    assert.equal(store.readAdjustmentPhotoDisk('ADJ_1'), null);

    // --- Dọn ảnh đệm ---
    const old = new Date('2026-09-10T00:00:00Z');
    const writeOld = (name: string) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, 'x');
      fs.utimesSync(p, old, old);
    };
    writeOld('old-synced.jpg');
    writeOld('old-unsynced.jpg');
    fs.writeFileSync(path.join(dir, 'new-month.jpg'), 'x');

    const r = store.cleanupAttendancePhotoDiskBefore('2026-10-01', (n) => n === 'old-unsynced.jpg');
    assert.equal(r.scanned, 3);
    assert.equal(r.removed, 1);
    assert.equal(fs.existsSync(path.join(dir, 'old-synced.jpg')), false);
    assert.equal(fs.existsSync(path.join(dir, 'old-unsynced.jpg')), true);
    assert.equal(fs.existsSync(path.join(dir, 'new-month.jpg')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.ATTENDANCE_PHOTO_DIR;
  }
});
