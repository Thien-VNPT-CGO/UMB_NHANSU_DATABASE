import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsSyncService } from '../src/services/google-sheets-sync.service.js';

/** 1 dòng kho lưu trữ: event_id, assignment_id, employee_id, type, ... client_time (cột 12). */
function archiveRow(eventId: string, employeeId: string, clientTime: string): string[] {
  return [eventId, `ASG_${eventId}`, employeeId, 'CHECK_IN', '', '', '', '', '', '', '', '', clientTime];
}

test('kho lưu trữ chỉ đọc Google 1 lần cho nhiều request song song', async () => {
  const svc = new GoogleSheetsSyncService();
  let reads = 0;
  (svc as any).readPartitionedRows = async () => {
    reads++;
    return [archiveRow('E1', 'EMP1', '2026-10-01T01:00:00Z')];
  };

  const [a, b] = await Promise.all([
    svc.getArchivedAttendanceEvents('2026-10-01', '2026-10-31'),
    svc.getArchivedAttendanceEvents('2026-10-01', '2026-10-31'),
  ]);
  assert.equal(reads, 1, '2 request đồng thời phải dùng chung 1 lượt đọc');
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);

  // Lần sau vẫn dùng cache (chưa hết hạn).
  await svc.getArchivedAttendanceEvents('2026-10-01', '2026-10-31');
  assert.equal(reads, 1);
});

test('xóa/ghi kho lưu trữ thì cache được bỏ ngay', async () => {
  const svc = new GoogleSheetsSyncService();
  let reads = 0;
  (svc as any).readPartitionedRows = async () => {
    reads++;
    return [archiveRow('E1', 'EMP1', '2026-10-01T01:00:00Z')];
  };

  await svc.getArchivedAttendanceEvents('2026-10-01', '2026-10-31');
  assert.equal(reads, 1);

  svc.invalidateArchivedAttendanceCache();
  await svc.getArchivedAttendanceEvents('2026-10-01', '2026-10-31');
  assert.equal(reads, 2, 'sau khi invalidate phải đọc lại');
});

test('lọc theo nhân viên trước khi map dữ liệu kho', async () => {
  const svc = new GoogleSheetsSyncService();
  (svc as any).readPartitionedRows = async () => [
    archiveRow('E1', 'EMP1', '2026-10-01T01:00:00Z'),
    archiveRow('E2', 'EMP2', '2026-10-01T02:00:00Z'),
  ];

  const mine = await svc.getArchivedAttendanceEvents('2026-10-01', '2026-10-31', 'EMP1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].employee_id, 'EMP1');

  const all = await svc.getArchivedAttendanceEvents('2026-10-01', '2026-10-31');
  assert.equal(all.length, 2);
});
