import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_MAX_BYTES,
  contractBufferLooksValid,
  contractDocsCell,
  contractFileInfo,
  contractKeyOf,
  contractKindOfKey,
  parseContractDocs,
} from '../src/utils/contracts.js';

test('contractKeyOf nhận cả PROBATION/OFFICIAL và tiếng Việt, chặn loại lạ', () => {
  assert.equal(contractKeyOf('PROBATION'), 'probation');
  assert.equal(contractKeyOf('probation'), 'probation');
  assert.equal(contractKeyOf('THU_VIEC'), 'probation');
  assert.equal(contractKeyOf('OFFICIAL'), 'official');
  assert.equal(contractKeyOf('CHINH_THUC'), 'official');
  assert.equal(contractKeyOf('THỬ VIỆC'), 'probation');
  assert.equal(contractKeyOf('hop-dong-khac'), null);
  assert.equal(contractKeyOf(''), null);
  assert.equal(contractKeyOf(null), null);
  assert.equal(contractKindOfKey('probation'), 'PROBATION');
  assert.equal(contractKindOfKey('official'), 'OFFICIAL');
});

test('parseContractDocs đọc object, chuỗi JSON và dữ liệu hỏng an toàn', () => {
  const meta = {
    drive_id: 'DRV123',
    file_name: 'HDLD.pdf',
    mime_type: 'application/pdf',
    size: 1234,
    uploaded_at: '2026-10-01T00:00:00.000Z',
    uploaded_by: 'HR1',
    storage: 'DRIVE',
  };
  const fromObject = parseContractDocs({ probation: meta });
  assert.equal(fromObject.probation?.file_name, 'HDLD.pdf');
  assert.equal(fromObject.official, undefined);

  const fromString = parseContractDocs(JSON.stringify({ official: meta }));
  assert.equal(fromString.official?.drive_id, 'DRV123');
  assert.equal(fromString.official?.storage, 'DRIVE');

  // camelCase (dữ liệu cũ / client gửi lên) vẫn đọc được.
  const camel = parseContractDocs({ probation: { driveId: 'X', fileName: 'a.docx', mimeType: 'application/msword', size: 10 } });
  assert.equal(camel.probation?.drive_id, 'X');
  assert.equal(camel.probation?.file_name, 'a.docx');

  assert.deepEqual(parseContractDocs(''), {});
  assert.deepEqual(parseContractDocs('{khong-phai-json'), {});
  assert.deepEqual(parseContractDocs(null), {});
  // Thiếu tên file -> coi như không có hợp đồng.
  assert.deepEqual(parseContractDocs({ probation: { drive_id: 'X' } }), {});
});

test('contractDocsCell ghi JSON gọn, rỗng khi chưa có hợp đồng', () => {
  assert.equal(contractDocsCell(undefined), '');
  assert.equal(contractDocsCell({}), '');
  const cell = contractDocsCell({
    probation: {
      drive_id: 'D1',
      file_name: 'ThuViec.pdf',
      mime_type: 'application/pdf',
      size: 100,
      uploaded_at: '2026-10-01T00:00:00.000Z',
      uploaded_by: 'HR1',
      storage: 'DISK',
    },
  });
  assert.match(cell, /ThuViec\.pdf/);
  assert.equal(JSON.parse(cell).probation.storage, 'DISK');
  // Đi vòng qua parse vẫn giữ nguyên dữ liệu.
  assert.equal(parseContractDocs(cell).probation?.file_name, 'ThuViec.pdf');
});

test('contractFileInfo nhận đúng MIME và đoán theo đuôi file', () => {
  assert.deepEqual(contractFileInfo('application/pdf', 'a.pdf'), { mime: 'application/pdf', ext: 'pdf' });
  assert.deepEqual(contractFileInfo('image/jpeg', 'a.JPG'), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(contractFileInfo('', 'hop-dong.docx'), {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  });
  assert.deepEqual(contractFileInfo('application/octet-stream', 'scan.png'), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(contractFileInfo('application/octet-stream', 'scan.jpeg'), { mime: 'image/jpeg', ext: 'jpg' });
  assert.equal(contractFileInfo('text/html', 'x.html'), null);
  assert.equal(contractFileInfo('', 'khong-duoi'), null);
});

test('contractBufferLooksValid chặn file đổi đuôi giả mạo', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)]);
  assert.equal(contractBufferLooksValid(pdf, 'application/pdf'), true);
  assert.equal(contractBufferLooksValid(Buffer.from('<html></html>'), 'application/pdf'), false);

  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  assert.equal(contractBufferLooksValid(jpg, 'image/jpeg'), true);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  assert.equal(contractBufferLooksValid(png, 'image/png'), true);
  assert.equal(contractBufferLooksValid(Buffer.from('not a png'), 'image/png'), false);

  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
  assert.equal(contractBufferLooksValid(webp, 'image/webp'), true);

  const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  assert.equal(contractBufferLooksValid(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
  const doc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
  assert.equal(contractBufferLooksValid(doc, 'application/msword'), true);
  assert.equal(contractBufferLooksValid(Buffer.alloc(0), 'application/pdf'), false);
});

test('giới hạn dung lượng hợp đồng là 6MB', () => {
  assert.equal(CONTRACT_MAX_BYTES, 6 * 1024 * 1024);
});

test('syncPendingContractsToDrive tự động upload hợp đồng DISK lên Drive và cập nhật metadata', async () => {
  const { EmployeesService } = await import('../src/services/employees.service.js');
  const { saveContractDisk, removeContractDisk } = await import('../src/services/contract-disk.store.js');

  const empId = `TEST_SYNC_EMP_${Date.now()}`;
  const pdfBuffer = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
  saveContractDisk(empId, 'PROBATION', 'pdf', pdfBuffer);

  const mockEmployee = {
    employee_id: empId,
    employee_code: 'NV_TEST',
    full_name: 'Nguyễn Văn Test',
    employment_status: 'PROBATION',
    contract_docs: {
      probation: {
        drive_id: '',
        file_name: 'HDLD_ThuViec.pdf',
        mime_type: 'application/pdf',
        size: pdfBuffer.length,
        uploaded_at: new Date().toISOString(),
        uploaded_by: 'HR',
        storage: 'DISK',
      },
    },
    version: 1,
  };

  let uploadedToDrive = false;
  let updatedDocs: any = null;

  const mockSync = {
    isDriveReady: () => true,
    uploadContractToDrive: async (fileName: string, mime: string, buffer: Buffer) => {
      uploadedToDrive = true;
      return { fileId: 'DRIVE_FILE_ID_12345', webViewLink: 'https://drive.google.com/test' };
    },
  };

  const mockRepo = {
    syncService: mockSync,
    listEmployees: async () => [mockEmployee],
    getEmployeeById: async () => mockEmployee,
    updateEmployee: async (id: string, patch: any) => {
      updatedDocs = patch.contract_docs;
      return { ...mockEmployee, ...patch };
    },
    recordAuditLog: async () => {},
  };

  const svc = new EmployeesService(mockRepo as any);
  const res = await svc.syncPendingContractsToDrive('SYSTEM');

  assert.equal(res.synced, 1);
  assert.equal(uploadedToDrive, true);
  assert.equal(updatedDocs?.probation?.drive_id, 'DRIVE_FILE_ID_12345');
  assert.equal(updatedDocs?.probation?.storage, 'DRIVE');

  // Dọn dẹp file test
  removeContractDisk(empId, 'PROBATION');
});
