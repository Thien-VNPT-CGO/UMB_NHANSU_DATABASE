import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidateAge, parseBirthYearValue, vietnamCurrentYear } from '@ubm/shared';
import { evaluateCandidateAiScore } from '../src/services/ai-scorer.js';

/**
 * CỘT NĂM SINH — CHẤM ĐIỂM THEO TUỔI THẬT (REALTIME):
 *   < 18 tuổi = 0 điểm | 18 đến dưới 20 tuổi = 1 điểm | từ 20 tuổi trở lên = 2 điểm.
 * Năm hiện tại lấy theo giờ Việt Nam, không hard-code nên sang năm mới điểm tự đổi.
 */

const NOW = new Date('2026-11-11T03:00:00.000Z'); // 10:00 giờ VN ngày 11/11/2026

test('vietnamCurrentYear: dùng giờ VN (đầu năm mới VN dù UTC còn năm cũ)', () => {
  assert.equal(vietnamCurrentYear(NOW), 2026);
  // 17:30 UTC 31/12 = 00:30 ngày 01/01 năm sau theo giờ VN.
  assert.equal(vietnamCurrentYear(new Date('2026-12-31T17:30:00.000Z')), 2027);
});

test('parseBirthYearValue: đọc năm sinh / khoảng tuổi / dữ liệu rỗng', () => {
  assert.equal(parseBirthYearValue(2003), 2003);
  assert.equal(parseBirthYearValue('2003'), 2003);
  assert.equal(parseBirthYearValue('Năm 2003'), 2003);
  // Khoảng tuổi của Form: lấy nhóm 4 số cuối (năm trẻ nhất) để không cộng điểm oan.
  assert.equal(parseBirthYearValue('2004 - 2008'), 2008);
  assert.equal(parseBirthYearValue('2008 trở lên'), 2008);
  assert.equal(parseBirthYearValue(''), null);
  assert.equal(parseBirthYearValue('không nhớ'), null);
  assert.equal(parseBirthYearValue(0), null);
});

test('tuổi < 18 → 0 điểm', () => {
  const r = evaluateCandidateAge(2009, NOW); // 17 tuổi
  assert.equal(r.age, 17);
  assert.equal(r.points, 0);
  assert.match(r.note, /dưới 18 tuổi/);
});

test('tuổi 18 và 19 → 1 điểm', () => {
  const r18 = evaluateCandidateAge(2008, NOW);
  assert.equal(r18.age, 18);
  assert.equal(r18.points, 1);
  const r19 = evaluateCandidateAge(2007, NOW);
  assert.equal(r19.age, 19);
  assert.equal(r19.points, 1);
});

test('từ 20 tuổi trở lên → 2 điểm', () => {
  for (const [year, age] of [[2006, 20], [2000, 26], [1990, 36]] as const) {
    const r = evaluateCandidateAge(year, NOW);
    assert.equal(r.age, age);
    assert.equal(r.points, 2, `năm sinh ${year} phải được 2 điểm`);
  }
});

test('thiếu / không hợp lệ / năm sinh tương lai → 0 điểm (không đoán tuổi)', () => {
  for (const raw of ['', 'không nhớ', null, undefined, 0, 2030]) {
    const r = evaluateCandidateAge(raw as any, NOW);
    assert.equal(r.points, 0);
    assert.equal(r.age, null);
    assert.match(r.note, /Chưa xác định/);
  }
});

test('khoảng tuổi Form "2004 - 2008" chỉ chấm theo năm trẻ nhất (không vượt điểm thật)', () => {
  const r = evaluateCandidateAge('2004 - 2008', NOW);
  assert.equal(r.birthYear, 2008);
  assert.equal(r.age, 18);
  assert.equal(r.points, 1);
});

test('AI scorer dùng đúng điểm tuổi thật cho tiêu chí 2', () => {
  const raw = evaluateCandidateAge('2006');
  const scored = evaluateCandidateAiScore({ full_name: 'Nguyễn Văn A', birth_year: '2006' });
  assert.equal(scored.breakdown.c2_birth_year.points, raw.points);
  assert.equal(scored.breakdown.c2_birth_year.note, raw.note);
});
