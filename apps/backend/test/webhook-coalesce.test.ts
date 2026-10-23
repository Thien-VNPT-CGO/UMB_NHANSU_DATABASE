import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsAdapter } from '../src/repositories/google-sheets.adapter.js';

test('webhook trong cửa sổ chống dồn được hẹn pull bù (không nuốt lần sửa cuối)', async () => {
  const adapter = new GoogleSheetsAdapter();
  (adapter as any).isConfigured = true;

  let calls = 0;
  let resolveFirst: ((value: unknown) => void) | null = null;
  (adapter as any).syncService = {
    pullAllDataFromGoogleSheets: () => {
      calls += 1;
      if (calls === 1) {
        return new Promise(resolve => { resolveFirst = resolve; });
      }
      return Promise.resolve({ success: true, counts: {}, changed: true });
    },
  };

  const first = adapter.triggerSheetsPull('webhook:NHAN_VIEN_MASTER');
  assert.equal(first.accepted, true);
  assert.equal(calls, 1);

  (resolveFirst as any)({ success: true, counts: {}, changed: true });
  await first.done;

  // Giả lập lần sửa thứ 2 rơi vào cuối cửa sổ 3 giây.
  (adapter as any).lastWebhookAt = Date.now() - 2900;
  const second = adapter.triggerSheetsPull('webhook:NHAN_VIEN_MASTER');
  assert.equal(second.accepted, false, 'lần trong cửa sổ không chạy pull ngay');

  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(calls, 2, 'phải chạy thêm một lượt pull bù để đọc lần sửa cuối');
});
