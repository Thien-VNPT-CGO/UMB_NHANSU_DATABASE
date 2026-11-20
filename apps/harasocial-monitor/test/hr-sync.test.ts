import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHrUpdates,
  findStaffForUpdate,
  normalizeHrShift,
  normalizeVietnamese,
  parseHrPayload,
} from '../shared/hr-sync';
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
    monitorChannelIds: ['ch1'],
    externalHrId: 'EMP_1',
    email: 'a@congty.vn',
    ...overrides,
  };
}

test('chuẩn hoá tên tiếng Việt bỏ dấu / giữ đ / khoảng trắng', () => {
  assert.equal(normalizeVietnamese('Nguyễn  Văn  Đức'), 'nguyen van duc');
  assert.equal(normalizeVietnamese('NGUYEN VAN DUC'), 'nguyen van duc');
  assert.equal(normalizeVietnamese('  Lê   Thị   Hoa  '), 'le thi hoa');
});

test('parse payload 1 nhân viên với startTime/endTime', () => {
  const [u] = parseHrPayload({ employeeId: 'EMP_9', fullName: 'Trần B', startTime: '8:00', endTime: '17:30', active: true });
  assert.equal(u.staffId, 'EMP_9');
  assert.equal(u.externalHrId, 'EMP_9');
  assert.equal(u.shift, '08:00 - 17:30');
  assert.equal(u.active, true);
});

test('parse payload mảng employees / shifts / schedules / items', () => {
  const employees = parseHrPayload({ employees: [{ employeeCode: 'E1', fullName: 'A', shift: '8h00-12h00' }] });
  assert.equal(employees.length, 1);
  assert.equal(employees[0].shift, '08:00 - 12:00');

  const shifts = parseHrPayload({ shifts: [{ externalHrId: 'E2', name: 'B', shift: '13:00 - 21:30' }] });
  assert.equal(shifts[0].externalHrId, 'E2');

  const schedules = parseHrPayload({ schedules: [{ staffId: 's3', shift: '07:00 - 11:00, 15:00 - 19:00' }] });
  assert.equal(schedules[0].shift, '07:00 - 11:00, 15:00 - 19:00');

  const items = parseHrPayload({ items: [{ employee_id: 'E4', employee_name: 'D', ca: '22:00 - 06:00' }] });
  assert.equal(items[0].shift, '22:00 - 06:00');
});

test('trạng thái nghỉ: isOff / status leave / nghi_phep => active=false', () => {
  assert.equal(parseHrPayload({ name: 'A', isOff: true })[0].active, false);
  assert.equal(parseHrPayload({ name: 'A', status: 'leave' })[0].active, false);
  assert.equal(parseHrPayload({ name: 'A', status: 'nghi_phep' })[0].active, false);
  assert.equal(parseHrPayload({ name: 'A', status: 'ĐANG LÀM' })[0].active, true);
  assert.equal(parseHrPayload({ name: 'A', shift: '08:00 - 17:00' })[0].active, true);
});

test('normalizeHrShift nhận nhiều định dạng', () => {
  assert.equal(normalizeHrShift('8h00-17h30'), '08:00 - 17:30');
  assert.equal(normalizeHrShift('08:00:00 - 17:30:00'), '08:00 - 17:30');
  assert.equal(normalizeHrShift('07:00-11:00, 13:00-17:30'), '07:00 - 11:00, 13:00 - 17:30');
  assert.equal(normalizeHrShift(''), undefined);
});

test('khớp theo thứ tự staffId → externalHrId → email → zaloUserId → tên', () => {
  const list = [
    staff(),
    staff({ id: 's2', name: 'Lê Thị Hoa', externalHrId: 'EMP_2', email: 'hoa@congty.vn', zaloUserId: '2222222' }),
    staff({ id: 's3', name: 'Phạm Minh', externalHrId: 'EMP_3', email: 'minh@congty.vn', zaloUserId: '3333333' }),
  ];
  assert.equal(findStaffForUpdate({ staffId: 's2', raw: {} }, list)?.id, 's2');
  assert.equal(findStaffForUpdate({ externalHrId: 'EMP_3', raw: {} }, list)?.id, 's3');
  assert.equal(findStaffForUpdate({ email: 'HOA@CONGTY.VN', raw: {} }, list)?.id, 's2');
  assert.equal(findStaffForUpdate({ zaloUserId: '3333333', raw: {} }, list)?.id, 's3');
  assert.equal(findStaffForUpdate({ name: 'pham minh', raw: {} }, list)?.id, 's3');
  assert.equal(findStaffForUpdate({ name: 'Nguyen Van A', raw: {} }, list)?.id, 's1');
});

test('trùng tên có dấu/không dấu vẫn giữ tên tiếng Việt chuẩn', () => {
  const list = [staff({ name: 'Nguyễn Văn Đức', externalHrId: null, email: null, zaloUserId: '' })];
  const result = applyHrUpdates(list, [{
    name: 'Nguyen Van Duc',
    shift: '09:00 - 18:00',
    active: true,
    raw: {},
  }], { ownerUid: 'u1' });
  assert.equal(result.patches.length, 1);
  const updated = result.created.length === 0 ? list[0] : result.created[0];
  assert.equal(updated.name, 'Nguyễn Văn Đức');
});

test('đồng bộ HR chỉ sửa ca/trạng thái, KHÔNG làm mất Zalo/cổng phụ trách', () => {
  const list = [staff()];
  const result = applyHrUpdates(list, [{
    staffId: 's1',
    shift: '22:00 - 06:00',
    active: false,
    externalHrId: 'EMP_1',
    email: 'new@congty.vn',
    raw: {},
  }], { ownerUid: 'u1' });

  assert.equal(result.matchedCount, 1);
  assert.deepEqual(result.patches[0].patch, {
    shift: '22:00 - 06:00',
    active: false,
    externalHrId: 'EMP_1',
    email: 'new@congty.vn',
  });
  // applyHrUpdates trả patch, caller áp vào DB — kiểm tra patch không chứa field Zalo.
  const keys = Object.keys(result.patches[0].patch);
  for (const forbidden of ['zaloUserId', 'zaloTag', 'monitorChannelIds', 'monitorChannelId', 'role', 'name']) {
    assert.equal(keys.includes(forbidden), false, forbidden);
  }
});

test('tự động tạo nhân viên mới khi bật autoCreateMissingStaff', () => {
  const result = applyHrUpdates([], [{
    externalHrId: 'EMP_NEW',
    name: 'Người Mới',
    shift: '08:00 - 12:00',
    active: true,
    raw: {},
  }], { ownerUid: 'u1', autoCreateMissingStaff: true, idFactory: () => 'new-id' });

  assert.equal(result.created.length, 1);
  const created = result.created[0];
  assert.equal(created.id, 'new-id');
  assert.equal(created.name, 'Người Mới');
  assert.equal(created.shift, '08:00 - 12:00');
  assert.equal(created.active, true);
  assert.equal(created.externalHrId, 'EMP_NEW');
  assert.deepEqual(created.monitorChannelIds, []);
});

test('không bật autoCreate => trả unmatched, không tạo rác', () => {
  const result = applyHrUpdates([], [{ name: 'Ai Đó', shift: '08:00 - 12:00', raw: {} }], { ownerUid: 'u1' });
  assert.equal(result.created.length, 0);
  assert.equal(result.unmatched.length, 1);
});
