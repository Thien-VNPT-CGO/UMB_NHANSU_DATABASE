import test from 'node:test';
import assert from 'node:assert/strict';
import { blacklistCell, parseBlacklist } from '../src/utils/blacklist.js';

const REC = {
  reason: 'Nghỉ giữa kỳ thử việc',
  note: 'Nghỉ sau 5 ngày, không bàn giao',
  blacklisted_at: '2026-11-11T02:00:00.000Z',
  blacklisted_by: 'ADMIN_01',
  stage: 'PROBATION' as const,
  probation_days: 5,
};

test('parseBlacklist đọc object, chuỗi JSON, camelCase và dữ liệu hỏng an toàn', () => {
  assert.deepEqual(parseBlacklist(REC), REC);
  assert.deepEqual(parseBlacklist(JSON.stringify(REC)), REC);
  const camel = parseBlacklist({
    reason: 'Nghỉ',
    blacklistedAt: '2026-11-11T02:00:00.000Z',
    blacklistedBy: 'ADMIN_02',
    probationDays: 9,
  });
  assert.equal(camel?.blacklisted_at, '2026-11-11T02:00:00.000Z');
  assert.equal(camel?.blacklisted_by, 'ADMIN_02');
  assert.equal(camel?.probation_days, 9);
  assert.equal(parseBlacklist(''), undefined);
  assert.equal(parseBlacklist('{khong-phai-json'), undefined);
  assert.equal(parseBlacklist(null), undefined);
  assert.equal(parseBlacklist({ note: 'thiếu lý do' }), undefined);
});

test('parseBlacklist chặn dữ liệu lạ: stage ngoài danh sách bị bỏ, số ngày kẹp 0..12', () => {
  const weird = parseBlacklist({ ...REC, stage: 'HACK', probation_days: 99 });
  assert.equal(weird?.stage, undefined);
  assert.equal(weird?.probation_days, 12);
  assert.equal(parseBlacklist({ ...REC, probation_days: -3 })?.probation_days, 0);
});

test('blacklistCell ghi JSON gọn, rỗng khi NV không nằm trong danh sách đen', () => {
  assert.equal(blacklistCell(undefined), '');
  assert.equal(blacklistCell({}), '');
  assert.equal(blacklistCell(null), '');
  const cell = blacklistCell(REC);
  assert.ok(cell.startsWith('{'));
  assert.equal(parseBlacklist(cell)?.reason, REC.reason);
  assert.equal(parseBlacklist(cell)?.probation_days, 5);
  // Không lưu ghi chú rỗng để ô Sheet gọn.
  assert.equal(JSON.parse(blacklistCell({ ...REC, note: '' })).note, undefined);
});
