import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSheetFormattingRequests,
  resolveTheme,
  type SheetDefinition,
} from '../src/services/sheets-beautifier.service.js';

// Tab có cột "Trạng Thái" -> beautifier sinh rule conditional formatting (status pill).
const def: SheetDefinition = {
  title: 'DON_NGHI_PHEP',
  headers: ['Mã Phiếu', 'Trạng Thái'],
};

const countCf = (requests: any[]): number =>
  requests.filter(r => !!r?.addConditionalFormatRule).length;

test('auto-beautify hằng ngày KHÔNG add conditional rule (chống phình rule)', () => {
  const requests = buildSheetFormattingRequests(1, def, resolveTheme(def.title), [], {
    skipConditionalRules: true,
  });
  assert.equal(countCf(requests), 0);
  // Vẫn phải chuẩn hoá giao diện (tab màu, header, độ rộng...).
  assert.ok(requests.length > 0);
});

test('beautify thủ công vẫn add rule trạng thái', () => {
  const requests = buildSheetFormattingRequests(1, def, resolveTheme(def.title), []);
  assert.ok(countCf(requests) > 0);
});
