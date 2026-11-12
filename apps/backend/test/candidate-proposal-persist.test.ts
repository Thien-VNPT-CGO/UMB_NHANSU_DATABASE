import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsSyncService, SHEETS_DEFINITIONS } from '../src/services/google-sheets-sync.service.js';

/**
 * Hồi quy: khi đẩy tab FROM_NHAN_VIEN, dòng dữ liệu phải có ĐỦ số cột theo
 * header — đặc biệt là 4 cột thêm sau: Ngày/Khung giờ/Ghi chú đề xuất PV và
 * Lý do danh sách đen. Trước đây hàm này ghi thiếu 4 cột nên mỗi lần đồng bộ
 * (xóa ứng viên, pull nguồn form...) là đề xuất lịch mới của ứng viên bị xóa
 * khỏi Sheet, HR không còn thấy ngày/giờ ứng viên đề xuất.
 */
test('pushCandidatesTab giữ đủ cột đề xuất lịch mới + lý do danh sách đen', async () => {
  const svc: any = Object.create(GoogleSheetsSyncService.prototype);
  let captured: { title: string; headers: string[]; rows: any[][] } | null = null;
  svc.overwriteSheetData = async (title: string, headers: string[], rows: any[][]) => {
    captured = { title, headers, rows };
    return rows.length;
  };

  const repo = {
    listCandidates: async () => [
      {
        submission_id: 'CAND_0001',
        full_name: 'Nguyễn Thị A',
        status: 'RESCHEDULE_PROPOSED',
        interview_decline_reason: 'Bận việc gia đình',
        interview_proposed_date: '2026-11-20',
        interview_proposed_time_slot: '15:30',
        interview_proposed_note: 'Chỉ rảnh buổi chiều',
      },
      {
        submission_id: 'CAND_0002',
        full_name: 'Trần Văn B',
        status: 'BLACKLIST',
        blacklist_reason: 'Xác nhận nhưng không đến PV',
      },
    ],
  };

  const count = await svc.pushCandidatesTab(repo as any);
  assert.equal(count, 2);
  assert.ok(captured, 'phải ghi tab FROM_NHAN_VIEN');

  const headers = SHEETS_DEFINITIONS.find(d => d.title === 'FROM_NHAN_VIEN')!.headers;
  assert.equal(captured!.headers.length, headers.length);

  const [rowA, rowB] = captured!.rows;
  assert.equal(rowA.length, headers.length, 'dòng phải đủ số cột theo header');
  assert.equal(rowB.length, headers.length, 'dòng phải đủ số cột theo header');

  // Vị trí cột (0-based) khớp đúng thứ tự header.
  assert.equal(headers[26], 'Lý Do Từ Chối PV');
  assert.equal(headers[27], 'Ngày Đề Xuất PV');
  assert.equal(headers[28], 'Khung Giờ Đề Xuất');
  assert.equal(headers[29], 'Ghi Chú Đề Xuất');
  assert.equal(headers[30], 'Lý Do Danh Sách Đen');

  assert.equal(rowA[26], 'Bận việc gia đình');
  assert.equal(rowA[27], '2026-11-20');
  assert.equal(rowA[28], '15:30');
  assert.equal(rowA[29], 'Chỉ rảnh buổi chiều');

  assert.equal(rowB[30], 'Xác nhận nhưng không đến PV');
});
