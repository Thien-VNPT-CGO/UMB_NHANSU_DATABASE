import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsSyncService, isAutoBeautifyEnabled } from '../src/services/google-sheets-sync.service.js';

/**
 * Regression: `SHEETS_AUTO_BEAUTIFY=0` phải tắt auto-beautify Ở MỌI chỗ.
 *
 * Trước đây cờ này chỉ chặn timer 24h trong server.ts, còn sync service vẫn tự
 * làm đẹp sau khi tạo tab mới và sau mỗi lượt push đủ. Mỗi lần restart container
 * (mỗi lần deploy) là 1 lượt beautify toàn bộ 25 spreadsheet → ~75 lần vượt hạn
 * mức đọc 60 lượt/phút, tranh quota với pull dữ liệu và backup.
 */

test('cờ SHEETS_AUTO_BEAUTIFY: 0/off/false/no tắt, các giá trị khác bật', () => {
  for (const off of ['0', 'off', 'OFF', 'false', 'False', 'no', ' no ']) {
    assert.equal(isAutoBeautifyEnabled(off), false, `phải tắt với "${off}"`);
  }
  for (const on of [undefined, '', '1', 'on', 'true', 'yes']) {
    assert.equal(isAutoBeautifyEnabled(on as any), true, `phải bật với "${String(on)}"`);
  }
});

test('SHEETS_AUTO_BEAUTIFY=0 -> không tự làm đẹp sau push, dù đã quá 6 giờ', () => {
  const saved = process.env.SHEETS_AUTO_BEAUTIFY;
  try {
    process.env.SHEETS_AUTO_BEAUTIFY = '0';
    const svc: any = new GoogleSheetsSyncService();
    svc.lastBeautifyAt = 0; // chưa từng làm đẹp
    assert.equal(svc.shouldAutoBeautify(Date.now()), false);
  } finally {
    if (saved === undefined) delete process.env.SHEETS_AUTO_BEAUTIFY;
    else process.env.SHEETS_AUTO_BEAUTIFY = saved;
  }
});

test('bật cờ: chỉ làm đẹp lại sau 6 giờ, không lặp mỗi lượt push', () => {
  const saved = process.env.SHEETS_AUTO_BEAUTIFY;
  try {
    process.env.SHEETS_AUTO_BEAUTIFY = '1';
    const svc: any = new GoogleSheetsSyncService();
    const now = Date.now();

    svc.lastBeautifyAt = now - 60 * 60_000; // 1 giờ trước
    assert.equal(svc.shouldAutoBeautify(now), false, 'chưa đủ 6 giờ thì không chạy lại');

    svc.lastBeautifyAt = now - 7 * 3_600_000; // 7 giờ trước
    assert.equal(svc.shouldAutoBeautify(now), true, 'quá 6 giờ thì chạy lại');

    svc.lastBeautifyAt = 0; // vừa restart, chưa từng làm đẹp
    assert.equal(svc.shouldAutoBeautify(now), true);
  } finally {
    if (saved === undefined) delete process.env.SHEETS_AUTO_BEAUTIFY;
    else process.env.SHEETS_AUTO_BEAUTIFY = saved;
  }
});
