import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSystemSettingsFromSheet } from '../src/services/google-sheets-sync.service.js';

/**
 * Ẩn/hiện cột Kế toán được lưu theo TÀI KHOẢN trong systemSettings
 * (`financeColumnVis:<adminId>`). Snapshot Google Sheets đi sau bộ nhớ vài giây,
 * nên nếu không so `updatedAt`, lượt pull kế tiếp sẽ ghi đè lựa chọn vừa bấm
 * bằng bản cũ trên Sheet → "lưu xong tải lại trang là mất cột".
 */

const KEY = 'financeColumnVis:ADM_KE_TOAN';

test('bản trong bộ nhớ MỚI HƠN thì giữ bộ nhớ (không bị Sheet cũ ghi đè)', () => {
  const mem = { [KEY]: { 'fin-payroll-periods': { stt: false, thuc: true }, updatedAt: '2026-11-11T07:00:00.000Z' } };
  const sheet = { [KEY]: { 'fin-payroll-periods': { stt: true, thuc: true }, updatedAt: '2026-11-11T06:59:00.000Z' } };

  const merged = mergeSystemSettingsFromSheet(mem, sheet);

  assert.equal(merged[KEY]['fin-payroll-periods'].stt, false, 'phải giữ cột vừa ẩn trong bộ nhớ');
  assert.equal(merged[KEY].updatedAt, '2026-11-11T07:00:00.000Z');
});

test('bản trên Sheet MỚI HƠN (máy khác lưu) thì nhận bản Sheet', () => {
  const mem = { [KEY]: { 'fin-payroll-periods': { stt: false }, updatedAt: '2026-11-11T06:00:00.000Z' } };
  const sheet = { [KEY]: { 'fin-payroll-periods': { stt: true, ung: false }, updatedAt: '2026-11-11T08:00:00.000Z' } };

  const merged = mergeSystemSettingsFromSheet(mem, sheet);

  assert.equal(merged[KEY]['fin-payroll-periods'].ung, false);
  assert.equal(merged[KEY].updatedAt, '2026-11-11T08:00:00.000Z');
});

test('tài khoản kế toán khác không bị ảnh hưởng (lưu riêng từng tài khoản)', () => {
  const other = 'financeColumnVis:ADM_KHAC';
  const mem = { [KEY]: { 'fin-payroll-periods': { stt: false }, updatedAt: '2026-11-11T07:00:00.000Z' } };
  const sheet = {
    [KEY]: { 'fin-payroll-periods': { stt: true }, updatedAt: '2026-11-11T06:00:00.000Z' },
    [other]: { 'fin-payroll-periods': { bonus: false }, updatedAt: '2026-11-11T06:30:00.000Z' },
  };

  const merged = mergeSystemSettingsFromSheet(mem, sheet);

  assert.equal(merged[KEY]['fin-payroll-periods'].stt, false);
  assert.equal(merged[other]['fin-payroll-periods'].bonus, false);
});

test('khóa không có updatedAt vẫn lấy theo Sheet như trước', () => {
  const merged = mergeSystemSettingsFromSheet({ lateFine: 10000 }, { lateFine: 20000 });
  assert.equal(merged.lateFine, 20000);
});

test('employee_salary_config vẫn gộp theo từng nhân viên như cũ', () => {
  const mem = {
    employee_salary_config: {
      E1: { base: 25000, updatedAt: '2026-11-11T07:00:00.000Z' },
      E2: { base: 20000, updatedAt: '2026-11-01T00:00:00.000Z' },
    },
  };
  const sheet = {
    employee_salary_config: {
      E1: { base: 10000, updatedAt: '2026-11-11T06:00:00.000Z' },
      E2: { base: 22000, updatedAt: '2026-11-11T07:30:00.000Z' },
    },
  };

  const merged = mergeSystemSettingsFromSheet(mem, sheet);

  assert.equal(merged.employee_salary_config.E1.base, 25000, 'E1: bộ nhớ mới hơn');
  assert.equal(merged.employee_salary_config.E2.base, 22000, 'E2: Sheet mới hơn');
});

test('probationAssessments gộp theo từng nhân viên: lịch vừa đặt không bị Sheet cũ ghi đè', () => {
  // HR vừa lên lịch cho E1 (bộ nhớ) nhưng Sheet chưa kịp ghi bản mới → pull về
  // bản cũ không được xóa mất lịch/link Meet của nhân viên thử việc.
  const mem = {
    probationAssessments: {
      E1: { meetDate: '2026-11-20', meetTime: '09:00', meetUrl: 'https://meet.google.com/new', updatedAt: '2026-11-14T09:00:00.000Z' },
      E2: { meetDate: '2026-11-10', meetTime: '10:00', meetUrl: 'https://meet.google.com/old', updatedAt: '2026-11-01T00:00:00.000Z' },
    },
  };
  const sheet = {
    probationAssessments: {
      E1: { meetDate: '2026-11-12', meetTime: '08:00', meetUrl: 'https://meet.google.com/stale', updatedAt: '2026-11-12T08:00:00.000Z' },
      E2: { meetDate: '2026-11-21', meetTime: '11:00', meetUrl: 'https://meet.google.com/from-sheet', updatedAt: '2026-11-14T10:00:00.000Z' },
    },
  };

  const merged = mergeSystemSettingsFromSheet(mem, sheet);

  assert.equal(merged.probationAssessments.E1.meetUrl, 'https://meet.google.com/new', 'E1: lịch vừa đặt trong bộ nhớ phải giữ');
  assert.equal(merged.probationAssessments.E2.meetUrl, 'https://meet.google.com/from-sheet', 'E2: lịch Sheet mới hơn thì nhận');
});
