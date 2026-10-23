import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsAdapter } from '../src/repositories/google-sheets.adapter.js';

test('webhook trong cửa sổ chống dồn được hẹn pull bù đúng tab (không nuốt lần sửa cuối)', async () => {
  const adapter = new GoogleSheetsAdapter();
  (adapter as any).isConfigured = true;

  let tabCalls = 0;
  const tabs: string[] = [];
  let resolveFirst: ((value: unknown) => void) | null = null;
  (adapter as any).syncService = {
    pullAllDataFromGoogleSheets: () => {
      throw new Error('webhook phải pull theo tab khi có cache');
    },
    pullTabFromGoogleSheets: (_repo: unknown, tab: string) => {
      tabCalls += 1;
      tabs.push(tab);
      if (tabCalls === 1) {
        return new Promise(resolve => { resolveFirst = resolve; });
      }
      return Promise.resolve({ success: true, counts: {}, changed: true });
    },
  };

  const first = adapter.triggerSheetsPull('webhook:NHAN_VIEN_MASTER');
  assert.equal(first.accepted, true);
  assert.equal(tabCalls, 1);
  assert.equal(tabs[0], 'NHAN_VIEN_MASTER');

  (resolveFirst as any)({ success: true, counts: {}, changed: true });
  await first.done;

  // Lần sửa thứ 2 rơi vào cuối cửa sổ chống dồn 1s.
  (adapter as any).lastWebhookAt = Date.now() - 900;
  const second = adapter.triggerSheetsPull('webhook:NHAN_VIEN_MASTER');
  assert.equal(second.accepted, false, 'lần trong cửa sổ không chạy pull ngay');

  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(tabCalls, 2, 'phải chạy thêm một lượt pull bù để đọc lần sửa cuối');
  assert.equal(tabs[1], 'NHAN_VIEN_MASTER', 'lượt bù vẫn pull đúng tab vừa sửa');
});
