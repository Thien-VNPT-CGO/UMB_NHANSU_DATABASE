import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeStaff, selectDutyStaff, staffCoversChannel } from '../shared/staff';
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

const AT_10AM_VN = '2026-06-01T03:00:00Z';
const AT_8PM_VN = '2026-06-01T13:00:00Z';

test('mảng cổng rỗng = phụ trách Tất cả', () => {
  assert.equal(staffCoversChannel({ monitorChannelIds: [], monitorChannelId: null }, 'ch1'), true);
  assert.equal(staffCoversChannel({ monitorChannelIds: ['ch1'], monitorChannelId: null }, 'ch1'), true);
  assert.equal(staffCoversChannel({ monitorChannelIds: ['ch1'], monitorChannelId: null }, 'ch2'), false);
  assert.equal(staffCoversChannel({ monitorChannelIds: ['ch1', 'ch2'], monitorChannelId: null }, 'ch2'), true);
  // Dữ liệu cũ chỉ có monitorChannelId
  assert.equal(staffCoversChannel({ monitorChannelId: 'ch9' } as any, 'ch9'), true);
  assert.equal(staffCoversChannel({ monitorChannelId: 'ch9' } as any, 'ch1'), false);
});

test('ưu tiên nhân viên được gán nếu đang trong ca', () => {
  const a = staff({ id: 'a' });
  const b = staff({ id: 'b', name: 'Trần B', zaloUserId: '7654321' });
  const result = selectDutyStaff([a, b], 'ch1', AT_10AM_VN, { assignedStaffId: 'b' });
  assert.equal(result.mode, 'assigned');
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].id, 'b');
});

test('nhân viên được gán hết ca => điều hướng sang người đang trực', () => {
  const offDuty = staff({ id: 'a', shift: '18:00 - 22:00' });
  const onDuty = staff({ id: 'b', shift: '08:00 - 17:30' });
  const result = selectDutyStaff([offDuty, onDuty], 'ch1', AT_10AM_VN, { assignedStaffId: 'a' });
  assert.equal(result.mode, 'redirect');
  assert.equal(result.targets[0].id, 'b');
});

test('nhân viên được gán bị tắt trực => điều hướng', () => {
  const result = selectDutyStaff(
    [staff({ id: 'a', active: false }), staff({ id: 'b' })],
    'ch1',
    AT_10AM_VN,
    { assignedStaffId: 'a' }
  );
  assert.equal(result.mode, 'redirect');
  assert.equal(result.targets[0].id, 'b');
});

test('tagAllOnDutyInShift tag toàn bộ người đang trực đúng cổng', () => {
  const result = selectDutyStaff(
    [
      staff({ id: 'a' }),
      staff({ id: 'b', monitorChannelIds: ['ch1'] }),
      staff({ id: 'c', monitorChannelIds: ['ch2'] }),
      staff({ id: 'd', active: false }),
      staff({ id: 'e', shift: '22:00 - 06:00' }),
    ],
    'ch1',
    AT_10AM_VN,
    { tagAllOnDutyInShift: true }
  );
  assert.equal(result.mode, 'all');
  assert.deepEqual(result.targets.map((s) => s.id), ['a', 'b']);
});

test('không ai trực => mode none', () => {
  const result = selectDutyStaff([staff({ shift: '22:00 - 06:00' })], 'ch1', AT_10AM_VN);
  assert.equal(result.mode, 'none');
  assert.equal(result.targets.length, 0);
  const night = selectDutyStaff([staff({ shift: '22:00 - 06:00' })], 'ch1', AT_8PM_VN + '');
  assert.equal(night.mode, 'none'); // 20:00 chưa vào ca 22:00
});

test('ca qua đêm được chọn đúng lúc 23:30 giờ Việt Nam', () => {
  const night = staff({ id: 'n', shift: '22:00 - 06:00', monitorChannelIds: ['ch1'] });
  const result = selectDutyStaff([night], 'ch1', '2026-06-01T16:30:00Z');
  assert.equal(result.mode, 'redirect');
  assert.equal(result.targets[0].id, 'n');
});

test('dedupeStaff theo UID Zalo', () => {
  const list = [staff({ id: 'a', zaloUserId: '1234567' }), staff({ id: 'b', zaloUserId: '1234567' }), staff({ id: 'c', zaloUserId: '9999999' })];
  assert.deepEqual(dedupeStaff(list).map((s) => s.id), ['a', 'c']);
});
