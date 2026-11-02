import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustmentDriveLocation,
  adjustmentRequestStatusLabel,
  buildAdjustmentRequestTxt,
  hhmmFromAdjustmentFileName,
} from '../src/services/google-sheets-sync.service.js';

const EMP = { full_name: 'Nguyễn Văn A', employee_code: 'EMP001' };

function adj(overrides: Record<string, any> = {}) {
  return {
    adjustment_id: 'ADJ_001',
    employee_id: 'EMP001',
    branch_id: 'CN1',
    assignment_id: 'ASG_001',
    reason: 'Quên check-in',
    minutes_requested: 45,
    status: 'PENDING',
    created_at: '2026-11-02T04:43:00.000Z', // 11:43 giờ VN
    ...overrides,
  };
}

test('adjustment drive: ngày gửi + tên folder theo giờ VN', () => {
  // 17:30 UTC ngày 01/11 = 00:30 VN ngày 02/11 -> phải sang ngày mới.
  const loc = adjustmentDriveLocation(
    adj({ created_at: '2026-11-01T17:30:00.000Z' }),
    EMP,
  );
  assert.equal(loc.day, '2026-11-02');
  assert.equal(loc.hhmm, '00-30');
  assert.equal(loc.empFolder, 'Nguyễn Văn A - EMP001');
  assert.deepEqual(loc.segments, ['2026-11-02', 'Nguyễn Văn A - EMP001']);
});

test('adjustment drive: bỏ ký tự cấm trong tên folder', () => {
  const loc = adjustmentDriveLocation(adj(), {
    full_name: 'A/B:C*D?',
    employee_code: 'EMP002',
  });
  assert.equal(loc.empFolder, 'A-B-C-D- - EMP002');
});

test('adjustment drive: thiếu nhân viên rớt về mã phiếu an toàn', () => {
  const loc = adjustmentDriveLocation(adj({ employee_id: '' }), null);
  assert.equal(loc.empFolder, 'KHONG_NV');
});

test('adjustment drive: nhãn trạng thái', () => {
  assert.equal(adjustmentRequestStatusLabel(adj()), 'Chờ duyệt');
  assert.equal(adjustmentRequestStatusLabel(adj({ status: 'APPROVED' })), 'Đã duyệt');
  assert.equal(adjustmentRequestStatusLabel(adj({ status: 'REJECTED', review_note: 'Sai giờ' })), 'Đã từ chối');
  assert.equal(
    adjustmentRequestStatusLabel(adj({ status: 'REJECTED', review_note: 'Tự động từ chối: quá hạn duyệt' })),
    'Tự động từ chối (hết hạn)',
  );
});

test('adjustment txt: lý do, số phút, hạn duyệt 30 phút', () => {
  const txt = buildAdjustmentRequestTxt(adj(), EMP, undefined, Date.parse('2026-11-02T04:45:00.000Z'));
  assert.match(txt, /LÝ DO & SỐ PHÚT : Quên check-in — 45 phút/);
  assert.match(txt, /Ngày gửi {8}: 02\/11\/2026 11:43 \(giờ VN\)/);
  assert.match(txt, /Hạn duyệt {7}: 02\/11\/2026 12:13 \(giờ VN\)/);
  assert.match(txt, /TRẠNG THÁI {6}: Chờ duyệt/);
  assert.match(txt, /Hình ảnh {8}: Không có ảnh/);
  assert.doesNotMatch(txt, /SỐ PHÚT DUYỆT/);
});

test('adjustment txt: hạn duyệt chốt muộn nhất 21:00 VN cùng ngày', () => {
  // 20:50 VN + 30 phút = 21:20 nhưng bị chốt ở 21:00.
  const txt = buildAdjustmentRequestTxt(
    adj({ created_at: '2026-11-02T13:50:00.000Z' }),
    EMP,
    undefined,
    Date.parse('2026-11-02T13:50:00.000Z'),
  );
  assert.match(txt, /Hạn duyệt {7}: 02\/11\/2026 21:00 \(giờ VN\)/);
});

test('adjustment txt: đã duyệt có số phút duyệt + link ảnh', () => {
  const txt = buildAdjustmentRequestTxt(
    adj({ status: 'APPROVED', minutes_approved: 30, review_note: 'OK' }),
    EMP,
    'FILE_IMG_123',
    Date.parse('2026-11-02T05:00:00.000Z'),
  );
  assert.match(txt, /SỐ PHÚT DUYỆT {3}: 30 phút/);
  assert.match(txt, /TRẠNG THÁI {6}: Đã duyệt/);
  assert.match(txt, /Ghi chú {9}: OK/);
  assert.match(txt, /https:\/\/drive\.google\.com\/file\/d\/FILE_IMG_123\/view/);
  assert.match(txt, /Cập nhật lúc {4}: 02\/11\/2026 12:00 \(giờ VN\)/);
});

test('adjustment drive: giữ đúng HH-mm của file txt cũ khi cập nhật trạng thái', () => {
  assert.equal(hhmmFromAdjustmentFileName('PHIEU_11-53_ADJ_1793595222829_691988.txt'), '11-53');
  assert.equal(hhmmFromAdjustmentFileName('ANH_11-53_ADJ_1.jpg'), '');
  assert.equal(hhmmFromAdjustmentFileName(''), '');
  assert.equal(hhmmFromAdjustmentFileName(undefined), '');
});
