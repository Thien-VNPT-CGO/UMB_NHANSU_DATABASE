import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildZaloInviteCell,
  normalizeFormFacebook,
  parseFormBirthYear,
  parseZaloInviteCell,
} from '../src/services/candidate-form-map.js';

test('parseFormBirthYear: giữ hành vi cũ (lấy nhóm 4 số cuối) cho ô chọn khoảng tuổi', () => {
  assert.equal(parseFormBirthYear('2004 - 2008'), 2008);
  assert.equal(parseFormBirthYear('2000 - 2004'), 2004);
  assert.equal(parseFormBirthYear('2008 trở lên'), 2008);
  assert.equal(parseFormBirthYear('2000'), 2000);
  assert.equal(parseFormBirthYear(''), 2002);
});

test('normalizeFormFacebook: giữ nguyên dữ liệu thật, không bịa URL', () => {
  const url = 'https://www.facebook.com/share/1CuBBVu5QY/';
  assert.equal(normalizeFormFacebook(url), url);
  // Giá trị không phải đường dẫn phải giữ nguyên như ứng viên đã gửi.
  assert.equal(normalizeFormFacebook('Pun Nguyễn'), 'Pun Nguyễn');
  assert.equal(normalizeFormFacebook('Ko'), 'Ko');
  assert.equal(normalizeFormFacebook('luciev.nguyen201@gmail.com'), 'luciev.nguyen201@gmail.com');
  // Thiếu scheme nhưng là đường dẫn FB -> bổ sung https.
  assert.equal(normalizeFormFacebook('facebook.com/abc'), 'https://facebook.com/abc');
  assert.equal(normalizeFormFacebook(''), '');
});

test('parseZaloInviteCell: SĐT/Zalo cũ không được nhận thành trạng thái gửi', () => {
  // Đây chính là dữ liệu cũ đang có trên Sheet đích (cột "Zalo Thư Mời").
  assert.deepEqual(parseZaloInviteCell('0792 536 788'), { note: '0792 536 788' });
  assert.deepEqual(parseZaloInviteCell('Zalo: 0773652843, sđt: 0777239472'), { note: 'Zalo: 0773652843, sđt: 0777239472' });
  assert.deepEqual(parseZaloInviteCell('sent'), { status: 'SENT' });
  assert.deepEqual(parseZaloInviteCell('NO_ZALO'), { status: 'NO_ZALO' });
  assert.deepEqual(parseZaloInviteCell(''), {});
});

test('buildZaloInviteCell: ưu tiên trạng thái, không có thì giữ ghi chú (không mất dữ liệu HR)', () => {
  assert.equal(buildZaloInviteCell('SENT', 'ghi chú'), 'SENT');
  assert.equal(buildZaloInviteCell(undefined, 'Zalo: 0773652843'), 'Zalo: 0773652843');
  assert.equal(buildZaloInviteCell('0792536788', 'Zalo phụ'), 'Zalo phụ');
  assert.equal(buildZaloInviteCell(undefined, undefined), '');
});
