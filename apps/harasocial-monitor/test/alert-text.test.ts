import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAlertText,
  buildGroupTestText,
  buildZaloMentionMessage,
  isValidZaloUid,
  toZcaContent,
} from '../shared/alert-text';
import type { SalesStaff } from '../shared/types';

function staff(overrides: Partial<SalesStaff> = {}): SalesStaff {
  return {
    id: 's1',
    ownerUid: 'u1',
    name: 'Nguyễn Văn A',
    zaloTag: 'Văn A',
    zaloUserId: '1234567',
    role: 'sale',
    shift: '08:00 - 17:30',
    active: true,
    monitorChannelId: null,
    monitorChannelIds: [],
    externalHrId: null,
    email: null,
    ...overrides,
  };
}

const base = {
  channelName: 'Fanpage Ụm Bò',
  customerName: 'Chị Lan',
  lastMessage: 'Shop ơi tư vấn giúp em',
  waitedMinutes: 6,
  thresholdMinutes: 5,
  reminderCount: 0,
};

test('nội dung cảnh báo lần 1 và nhắc lại', () => {
  const first = buildAlertText(base);
  assert.match(first.text, /HARASOCIAL/);
  assert.match(first.text, /Đã chờ: 6 phút \(SLA 5 phút\)/);
  assert.match(first.text, /Chị Lan/);
  assert.doesNotMatch(first.text, /NHẮC LẠI/);

  const repeat = buildAlertText({ ...base, reminderCount: 2, waitedMinutes: 9 });
  assert.match(repeat.text, /NHẮC LẠI LẦN 2/);
  assert.match(repeat.text, /9 phút/);
});

test('UID Zalo hợp lệ phải >= 6 chữ số', () => {
  assert.equal(isValidZaloUid('123456'), true);
  assert.equal(isValidZaloUid('12345'), false);
  assert.equal(isValidZaloUid('abc123456'), false);
  assert.equal(isValidZaloUid(''), false);
});

test('tạo mention đúng pos/len trong chuỗi UTF-16', () => {
  const msg = buildZaloMentionMessage({ ...base, staff: [staff(), staff({ id: 's2', name: 'Trần B', zaloTag: 'Trần B', zaloUserId: '7654321' })] });
  assert.equal(msg.mentions.length, 2);
  assert.equal(msg.tagged.length, 2);
  for (const mention of msg.mentions) {
    assert.equal(msg.text.slice(mention.pos, mention.pos + mention.len), `@${mention.uid === '1234567' ? 'Văn A' : 'Trần B'}`);
  }
  // Emoji 🚨 (2 code units) trước tag không làm lệch offset.
  const first = msg.mentions[0];
  assert.equal(msg.text.slice(first.pos - 3, first.pos), '👉 ');
});

test('bỏ qua mention khi UID không hợp lệ nhưng vẫn hiện tên', () => {
  const msg = buildZaloMentionMessage({
    ...base,
    staff: [staff({ zaloUserId: '12345' }), staff({ id: 's2', name: 'Trần B', zaloTag: 'Trần B', zaloUserId: '7654321' })],
  });
  assert.equal(msg.mentions.length, 1);
  assert.equal(msg.skipped.length, 1);
  assert.match(msg.text, /@Văn A/);
});

test('dedupe theo UID: một người chỉ tag 1 lần', () => {
  const msg = buildZaloMentionMessage({
    ...base,
    staff: [staff(), staff({ id: 'khac', name: 'Bí danh', zaloTag: 'Bí danh', zaloUserId: '1234567' })],
  });
  assert.equal(msg.mentions.length, 1);
  const zca = toZcaContent(msg);
  assert.equal(zca.msg, msg.text);
  assert.deepEqual(zca.mentions, msg.mentions);
});

test('không có nhân viên => không tạo dòng tag', () => {
  const msg = buildZaloMentionMessage({ ...base, staff: [] });
  assert.equal(msg.mentions.length, 0);
  assert.doesNotMatch(msg.text, /👉/);
});

test('tin test nhóm chứa tên nhóm và giờ Việt Nam', () => {
  const text = buildGroupTestText('Nhóm Sale', '2026-06-01T03:00:00Z');
  assert.match(text, /Nhóm Sale/);
  assert.match(text, /01\/06\/2026/);
});
