import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetNumber } from '../src/services/google-sheets-sync.service.js';

test('đọc số ô Sheets: dấu phẩy thập phân kiểu Việt Nam', () => {
  assert.equal(parseSheetNumber('10,799831'), 10.799831);
  assert.equal(parseSheetNumber('106,69337'), 106.69337);
  assert.equal(parseSheetNumber(' 10,856457 '), 10.856457);
  assert.equal(parseSheetNumber('300'), 300);
  assert.equal(parseSheetNumber(10.759223), 10.759223);
});

test('đọc số ô Sheets: phân cách nghìn + số chuẩn quốc tế', () => {
  assert.equal(parseSheetNumber('1.234,56'), 1234.56);
  assert.equal(parseSheetNumber('1,234.56'), 1234.56);
  assert.equal(parseSheetNumber('10.799831'), 10.799831);
});

test('đọc số ô Sheets: ô trống/không phải số trả undefined', () => {
  assert.equal(parseSheetNumber(''), undefined);
  assert.equal(parseSheetNumber('   '), undefined);
  assert.equal(parseSheetNumber('ACTIVE'), undefined);
  assert.equal(parseSheetNumber(null), undefined);
  assert.equal(parseSheetNumber(undefined), undefined);
});
