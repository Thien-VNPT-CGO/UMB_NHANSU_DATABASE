import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePayrollInputRows } from '../src/services/google-sheets-sync.service.js';

/**
 * Nhập tay theo kỳ: pull từ DULIEU_LUONG_KY KHÔNG được lấy bản Sheet cũ đè
 * lên ô Kế toán vừa lưu (lỗi "lưu xong F5 mất dữ liệu").
 */
test('mergePayrollInputRows giữ bộ nhớ mới hơn Sheet cũ', () => {
  const memory = [{
    period: '2026-10', employee_id: 'E1',
    luong_cb: 1500000, ot_extra: 200000, bonus_extra: 0,
    ung_luong: 0, tru_kpi: 0, dong_phuc: 0,
    note: 'vừa nhập', updatedAt: '2026-11-07T10:00:00.000Z',
  }];
  // Sheet còn bản cũ (chưa kịp push): số 0, mốc cũ hơn.
  const rows = [[
    '2026-10', 'E1', 0, 0, 0, 0, 0, 0, '', 'ADM', '2026-11-07T09:00:00.000Z',
  ]];
  const out = mergePayrollInputRows(memory, rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].luong_cb, 1500000);
  assert.equal(out[0].ot_extra, 200000);
  assert.equal(out[0].note, 'vừa nhập');
});

test('mergePayrollInputRows nhận bản Sheet mới hơn bộ nhớ', () => {
  const memory = [{
    period: '2026-10', employee_id: 'E1', luong_cb: 100,
    updatedAt: '2026-11-07T09:00:00.000Z',
  }];
  const rows = [[
    '2026-10', 'E1', '1.500.000', '250.000', 0, 0, 0, 0, 'Sheet mới', 'ADM', '2026-11-07T11:00:00.000Z',
  ]];
  const out = mergePayrollInputRows(memory, rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].luong_cb, 1500000, 'phải hiểu số định dạng VN');
  assert.equal(out[0].ot_extra, 250000);
  assert.equal(out[0].note, 'Sheet mới');
});

test('mergePayrollInputRows: Sheet thiếu mốc thời gian không đè bộ nhớ có mốc', () => {
  const memory = [{
    period: '2026-11', employee_id: 'E2', bonus_extra: 300000,
    updatedAt: '2026-11-07T10:00:00.000Z',
  }];
  const rows = [['2026-11', 'E2', 0, 0, 0, 0, 0, 0, 'cũ', 'ADM', '']];
  const out = mergePayrollInputRows(memory, rows);
  assert.equal(out[0].bonus_extra, 300000);
});

test('mergePayrollInputRows thêm dòng chỉ có trên Sheet + chuẩn hóa kỳ', () => {
  const out = mergePayrollInputRows([], [
    ['2026-10-01', 'E3', '2.000.000', 0, 0, 0, 0, 0, 'mới', 'ADM', '2026-11-07T11:00:00.000Z'],
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].period, '2026-10');
  assert.equal(out[0].employee_id, 'E3');
  assert.equal(out[0].luong_cb, 2000000);
});
