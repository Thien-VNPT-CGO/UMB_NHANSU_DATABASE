import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import {
  BANK_CHANGE_COOLDOWN_MS,
  BANK_CHANGE_KEY_PREFIX,
  bankAccountKey,
  bankChangeRemainingSeconds,
  bankInfoChanged,
  buildBankChangeRequest,
  canApproveBankChange,
  deletePendingBankChangeRequest,
  findBankAccountConflict,
  getPendingBankChangeRequest,
  isFirstBankEntry,
  listPendingBankChangeRequests,
  maskBankAccount,
  normalizeBankInfo,
  savePendingBankChangeRequest,
} from '../src/services/bank-change.service.js';

test('lần đầu nhập STK được lưu ngay, lần sau mới cần duyệt', () => {
  const empty = normalizeBankInfo({});
  const first = normalizeBankInfo({ bankName: 'VCB', bankAccount: '0123456789', bankHolder: 'NGUYEN VAN A' });
  assert.equal(isFirstBankEntry(empty, first), true);
  assert.equal(bankInfoChanged(empty, first), true);

  const current = first;
  const changed = normalizeBankInfo({ bankName: 'TCB', bankAccount: '9876543210', bankHolder: 'NGUYEN VAN A' });
  assert.equal(isFirstBankEntry(current, changed), false);
  assert.equal(bankInfoChanged(current, changed), true);
});

test('so sánh STK bỏ khoảng trắng/gạch/dấu chấm, QR phải giống hệt', () => {
  const a = normalizeBankInfo({ bankAccount: '0123 456 789', bankQrImg: 'data:image/png;base64,AAA' });
  const b = normalizeBankInfo({ bankAccount: '0123-456.789', bankQrImg: 'data:image/png;base64,AAA' });
  assert.equal(bankInfoChanged(a, b), false);

  const c = normalizeBankInfo({ bankAccount: '0123 456 789', bankQrImg: 'data:image/png;base64,BBB' });
  assert.equal(bankInfoChanged(a, c), true);
});

test('yêu cầu đổi STK được duyệt ngay (không còn chờ 48h) và không lưu QR cũ', () => {
  const now = Date.UTC(2026, 9, 23, 0, 0, 0);
  const request = buildBankChangeRequest({
    employeeId: 'EMP_001',
    requestedBy: 'EMP_001',
    current: { bank_name: 'VCB', bank_account: '0123456789', bank_holder: 'A', bank_qr_img: 'old-qr' },
    requested: { bank_name: 'TCB', bank_account: '9876543210', bank_holder: 'A', bank_qr_img: 'new-qr' },
    now,
  });
  assert.equal(request.status, 'PENDING');
  assert.equal(BANK_CHANGE_COOLDOWN_MS, 0);
  assert.equal(new Date(request.apply_after).getTime(), now);
  assert.equal(request.old.bank_qr_img, undefined, 'không nhân đôi QR cũ trong system settings');
  assert.equal(request.requested.bank_qr_img, 'new-qr');
  assert.match(request.request_id, /^BCR_/);
});

test('duyệt được ngay, không còn số giây chờ', () => {
  const now = Date.UTC(2026, 9, 23, 0, 0, 0);
  const request = buildBankChangeRequest({
    employeeId: 'EMP_003',
    requestedBy: 'EMP_003',
    current: { bank_account: '1111' },
    requested: { bank_account: '2222' },
    now,
  });
  assert.equal(canApproveBankChange(request, now), true);
  assert.equal(bankChangeRemainingSeconds(request, now), 0);
});

test('phát hiện STK trùng sau chuẩn hóa, bỏ qua chính nhân viên đang đổi', () => {
  assert.equal(bankAccountKey('0123 456-789'), '0123456789');
  const employees = [
    { employee_id: 'EMP_A', employee_code: 'A01', full_name: 'Nguyễn A', bank_account: '0123 456 789' },
    { employee_id: 'EMP_B', employee_code: 'B02', full_name: 'Trần B', bank_account: '999999999' },
  ];
  const clash = findBankAccountConflict(employees, 'EMP_B', '0123456789');
  assert.equal(clash?.employee_id, 'EMP_A');
  assert.equal(clash?.full_name, 'Nguyễn A');
  assert.equal(findBankAccountConflict(employees, 'EMP_A', '0123456789'), null);
  assert.equal(findBankAccountConflict(employees, 'EMP_B', '999999999'), null);
  assert.equal(findBankAccountConflict(employees, 'EMP_B', ''), null);
});

test('che STK trong audit/UI cũ', () => {
  assert.equal(maskBankAccount('0123456789'), '••••••6789');
  assert.equal(maskBankAccount(''), '—');
  assert.equal(maskBankAccount('1234'), '••34');
});

test('lưu / đọc / xóa yêu cầu trong system settings không đổi schema nhân viên', async () => {
  const repo = new MockSheetsAdapter();
  const request = buildBankChangeRequest({
    employeeId: 'EMP_002',
    requestedBy: 'EMP_002',
    current: { bank_name: 'VCB', bank_account: '1111', bank_holder: 'A' },
    requested: { bank_name: 'TCB', bank_account: '2222', bank_holder: 'A' },
  });

  await savePendingBankChangeRequest(repo, request);
  const settings = await repo.getSystemSettings();
  assert.ok(settings[`${BANK_CHANGE_KEY_PREFIX}EMP_002`]);
  assert.equal((await getPendingBankChangeRequest(repo, 'EMP_002'))?.request_id, request.request_id);
  assert.equal((await listPendingBankChangeRequests(repo)).length, 1);

  await deletePendingBankChangeRequest(repo, 'EMP_002');
  assert.equal(await getPendingBankChangeRequest(repo, 'EMP_002'), null);
  assert.equal((await listPendingBankChangeRequests(repo)).length, 0);
});
