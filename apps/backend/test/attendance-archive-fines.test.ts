import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsSyncService } from '../src/services/google-sheets-sync.service.js';

/**
 * Kho lưu trữ tuần cũ phải giữ CỜ TRỄ + MỨC PHẠT như tab realtime. Nếu archive
 * bỏ mấy cột này thì kỳ lương/lưới công đọc kho sẽ tự suy lại số phút trễ từ giờ
 * vào ca -> ca đã được duyệt bù công vẫn bị phạt 100% lần nữa.
 */

function archiveRow(eventId: string, clientTime: string, extra: Record<number, string> = {}): string[] {
  const row = [eventId, `ASG_${eventId}`, 'EMP1', 'CHECK_IN', '', '', '', '', '', '', '', '', clientTime];
  for (const [idx, val] of Object.entries(extra)) row[Number(idx)] = val;
  return row;
}

test('đọc kho lưu trữ: giữ đúng cờ trễ + nấc phạt đã ghi nhận', async () => {
  const svc = new GoogleSheetsSyncService();
  (svc as any).readPartitionedRows = async () => [
    archiveRow('E_LATE', '2026-10-01T01:20:00Z', { 13: 'YES', 14: 'NO', 15: '80', 16: 'FULL_SHIFT', 17: '125000' }),
    archiveRow('E_OK', '2026-10-01T00:00:00Z', { 13: 'NO', 14: 'NO', 15: '0', 16: 'NONE', 17: '0' }),
    // Dòng archive cũ (13 cột): không có cờ -> phải để undefined để nơi tính
    // lương còn suy bù từ giờ vào ca (không được coi là "đúng giờ").
    archiveRow('E_OLD', '2026-10-01T00:30:00Z'),
  ];

  const list = await svc.getArchivedAttendanceEvents('2026-10-01', '2026-10-31');
  const byId = new Map(list.map((e: any) => [e.event_id, e]));

  const late: any = byId.get('E_LATE');
  assert.equal(late.is_late, true);
  assert.equal(late.minutes_deviation, 80);
  assert.equal(late.fine_tier, 'FULL_SHIFT');
  assert.equal(late.fine_amount, 125000);

  const ok: any = byId.get('E_OK');
  assert.equal(ok.is_late, false);
  assert.equal(ok.minutes_deviation, 0);
  assert.equal(ok.fine_tier, 'NONE');

  const old: any = byId.get('E_OLD');
  assert.equal(old.is_late, undefined, 'dòng cũ thiếu cột cờ -> undefined, không phải false');
});

test('clearArchivedEventFines: gỡ phạt trong kho bằng 1 lượt ghi, bỏ cache', async () => {
  const svc = new GoogleSheetsSyncService();
  (svc as any).sheetsClient = {}; // chỉ cần truthy, các call Google đã được stub
  let writes = 0;
  let stored: string[][] = [
    archiveRow('E_LATE', '2026-10-01T01:20:00Z', { 13: 'YES', 15: '80', 16: 'FULL_SHIFT', 17: '125000' }),
    archiveRow('E_KEEP', '2026-10-01T02:00:00Z', { 13: 'YES', 15: '30', 16: 'FLAT_30K', 17: '30000' }),
  ];
  (svc as any).readPartitionedRows = async () => stored;
  (svc as any).rewritePartitionedTab = async (_title: string, rows: string[][]) => {
    writes++;
    stored = rows;
  };

  const fixed = await svc.clearArchivedEventFines(['E_LATE']);
  assert.equal(fixed, 1);
  assert.equal(writes, 1, 'gộp mọi event_id vào 1 lượt ghi');

  const cleared = stored.find(r => r[0] === 'E_LATE')!;
  assert.equal(cleared[13], 'NO');
  assert.equal(cleared[15], '0');
  assert.equal(cleared[16], 'NONE');
  assert.equal(cleared[17], '0');

  const untouched = stored.find(r => r[0] === 'E_KEEP')!;
  assert.equal(untouched[13], 'YES');
  assert.equal(untouched[16], 'FLAT_30K');

  // Đã sạch -> không ghi lại.
  const again = await svc.clearArchivedEventFines(['E_LATE']);
  assert.equal(again, 0);
  assert.equal(writes, 1);
});
