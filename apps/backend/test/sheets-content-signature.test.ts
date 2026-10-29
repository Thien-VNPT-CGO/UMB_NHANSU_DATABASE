import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSheetsContentSignature, fingerprintSheetsContent } from '../src/utils/sheets-content-signature.js';

const tabs = {
  NHAN_VIEN_MASTER: [
    ['ID Nhân Viên', 'Họ Và Tên', 'Trạng Thái'],
    ['NV001', 'Nguyễn Văn A', 'ACTIVE'],
    ['NV002', 'Trần Thị B', 'ACTIVE'],
  ],
  PHAN_CONG_CA: [
    ['ID Ca', 'Nhân Viên', 'Ngày'],
    ['CA001', 'NV001', '2026-10-23'],
  ],
};

test('hash nội dung ổn định khi dữ liệu không đổi', () => {
  const a = computeSheetsContentSignature(tabs);
  const b = computeSheetsContentSignature({
    PHAN_CONG_CA: tabs.PHAN_CONG_CA,
    NHAN_VIEN_MASTER: tabs.NHAN_VIEN_MASTER,
  });
  assert.equal(a, b);
});

test('sửa nội dung một ô (counts không đổi) vẫn đổi hash', () => {
  const before = computeSheetsContentSignature(tabs);
  const edited = {
    ...tabs,
    NHAN_VIEN_MASTER: [
      ['ID Nhân Viên', 'Họ Và Tên', 'Trạng Thái'],
      ['NV001', 'Nguyễn Văn A', 'RESIGNED'], // đổi trạng thái, vẫn 3 dòng
      ['NV002', 'Trần Thị B', 'ACTIVE'],
    ],
  };
  const after = computeSheetsContentSignature(edited);
  assert.notEqual(before, after);
  assert.equal(edited.NHAN_VIEN_MASTER.length, tabs.NHAN_VIEN_MASTER.length);
});

test('fingerprint chỉ ra đúng tab vừa đổi', () => {
  const before = fingerprintSheetsContent(tabs);
  const edited = {
    ...tabs,
    PHAN_CONG_CA: [
      ['ID Ca', 'Nhân Viên', 'Ngày'],
      ['CA001', 'NV001', '2026-10-24'],
    ],
  };
  const after = fingerprintSheetsContent(edited);
  const changedTabs = Object.keys(after.tabs).filter(t => before.tabs[t] !== after.tabs[t]);
  assert.deepEqual(changedTabs, ['PHAN_CONG_CA']);
});

test('thêm/xoá dòng và đổi tab ứng viên đều đổi hash', () => {
  const base = computeSheetsContentSignature(tabs);
  const withRow = computeSheetsContentSignature({
    ...tabs,
    PHAN_CONG_CA: [...tabs.PHAN_CONG_CA, ['CA002', 'NV002', '2026-10-23']],
  });
  assert.notEqual(base, withRow);

  const candidateChanged = computeSheetsContentSignature(tabs, [['UV01', 'Nguyễn Văn C']]);
  const candidateChanged2 = computeSheetsContentSignature(tabs, [['UV01', 'Nguyễn Văn D']]);
  assert.notEqual(candidateChanged, candidateChanged2);
});

test('sửa tay lịch PV trên tab FROM_NHAN_VIEN (master) cũng đổi hash + báo đúng tab', () => {
  const beforeTabs = {
    ...tabs,
    FROM_NHAN_VIEN: [
      ['Họ Và Tên', 'Số Điện Thoại', 'Ngày PV', 'Khung Giờ PV'],
      ['Nguyễn Văn C', '0901234567', '2026-10-30', '09:00'],
    ],
  };
  const before = fingerprintSheetsContent(beforeTabs);
  const after = fingerprintSheetsContent({
    ...beforeTabs,
    FROM_NHAN_VIEN: [
      ['Họ Và Tên', 'Số Điện Thoại', 'Ngày PV', 'Khung Giờ PV'],
      ['Nguyễn Văn C', '0901234567', '2026-10-30', '14:00'],
    ],
  });
  assert.notEqual(before.signature, after.signature);
  const changedTabs = Object.keys(after.tabs).filter(t => before.tabs[t] !== after.tabs[t]);
  assert.deepEqual(changedTabs, ['FROM_NHAN_VIEN']);
});
