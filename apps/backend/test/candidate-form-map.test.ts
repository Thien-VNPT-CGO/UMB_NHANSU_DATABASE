import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildZaloInviteCell,
  candidateIdentityKey,
  isHrBranchLabel,
  isHrShiftLabel,
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

test('normalizeFormFacebook: sao y nguyên văn, không bịa URL', () => {
  for (const v of [
    'https://www.facebook.com/share/1CuBBVu5QY/',
    'Pun Nguyễn',
    'Ko',
    'luciev.nguyen201@gmail.com',
    'www.facebook.com/nguyet.mie187',
  ]) {
    assert.equal(normalizeFormFacebook(v), v);
  }
  assert.equal(normalizeFormFacebook(''), '');
});

test('isHrShiftLabel / isHrBranchLabel: chỉ nhận nhãn HR chốt qua dropdown', () => {
  assert.equal(isHrShiftLabel('Ca sáng (07-12)'), true);
  assert.equal(isHrShiftLabel('Ca tối (18-23)'), true);
  // Câu trả lời thô của form KHÔNG phải ca HR đã chốt.
  assert.equal(isHrShiftLabel('Ca Sáng: 7g00 - 12g00'), false);
  assert.equal(isHrShiftLabel('Có thể làm từ 2 Ca trở lên'), false);
  assert.equal(isHrBranchLabel('Ụm Bò Milk - CN2 (261 Tô Hiến Thành)'), true);
  assert.equal(isHrBranchLabel('CN2: 261 Tô Hiến Thành, Phường 12, Quận 10'), false);
});

test('candidateIdentityKey: ghép đúng người theo SĐT + tên, bỏ qua định dạng SĐT', () => {
  assert.equal(
    candidateIdentityKey('0938 387 661', ' Nguyễn  Văn   A '),
    candidateIdentityKey('0938387661', 'nguyễn văn a'),
  );
  assert.notEqual(
    candidateIdentityKey('0938387661', 'Nguyễn Văn A'),
    candidateIdentityKey('0938387661', 'Nguyễn Văn B'),
  );
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
