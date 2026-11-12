import test from 'node:test';
import assert from 'node:assert/strict';
import { EmployeesService } from '../src/services/employees.service.js';
import { removeContractDisk } from '../src/services/contract-disk.store.js';

/**
 * Hồi quy: nhân viên tự tải Hợp đồng thử việc / Hợp đồng chính thức ở cổng NV.
 *
 * - File phải được upload lên Google Drive ngay (storage = DRIVE, có drive_id).
 * - Metadata phải ghi vào contract_docs của hồ sơ để cổng Admin hiển thị.
 * - Audit phải ghi actor_role = EMPLOYEE (phân biệt HR upload hộ).
 */
test('NV tự upload hợp đồng thử việc: lưu Drive + contract_docs + audit EMPLOYEE', async () => {
  const empId = `TEST_EMP_UP_${Date.now()}`;
  const emp: any = {
    employee_id: empId,
    employee_code: 'NV_TEST',
    full_name: 'Nguyễn Văn Test',
    employment_status: 'PROBATION',
    default_branch_id: 'CN1',
    contract_docs: undefined,
    version: 1,
  };
  let audit: any = null;
  let uploadedName = '';
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]);

  const repo: any = {
    syncService: {
      isDriveReady: () => true,
      uploadEmployeeProfileToDrive: async (fileName: string) => {
        uploadedName = fileName;
        return { fileId: 'DRIVE_ID_EMPLOYEE_UPLOAD' };
      },
    },
    getEmployeeById: async () => emp,
    updateEmployee: async (_id: string, patch: any) => {
      Object.assign(emp, patch);
      return emp;
    },
    recordAuditLog: async (log: any) => { audit = log; },
  };

  const svc = new EmployeesService(repo);
  const r = await svc.saveContract(
    empId,
    { kind: 'PROBATION', fileName: 'hop-dong-thu-viec.pdf', mimeType: 'application/pdf', base64: pdf.toString('base64') },
    empId,
  );

  assert.equal(uploadedName, 'Hợp đồng thử việc.pdf', 'tên file trên Drive phải cố định theo loại hợp đồng');
  assert.equal(r.meta.storage, 'DRIVE');
  assert.equal(r.meta.drive_id, 'DRIVE_ID_EMPLOYEE_UPLOAD');
  assert.equal(r.meta.file_name, 'hop-dong-thu-viec.pdf');
  assert.equal(r.meta.uploaded_by, empId);
  assert.equal((emp.contract_docs as any).probation.drive_id, 'DRIVE_ID_EMPLOYEE_UPLOAD');
  assert.equal(audit?.action, 'UPLOAD_CONTRACT');
  assert.equal(audit?.actor_role, 'EMPLOYEE');
  assert.match(String(audit?.details || ''), /hợp đồng thử việc/i);

  removeContractDisk(empId, 'PROBATION');
});

test('NV tự upload hợp đồng chính thức: ghi đúng key official, không đụng probation', async () => {
  const empId = `TEST_EMP_UP2_${Date.now()}`;
  const emp: any = {
    employee_id: empId,
    employee_code: 'NV_TEST2',
    full_name: 'Trần Thị Test',
    employment_status: 'OFFICIAL',
    default_branch_id: 'CN2',
    contract_docs: {
      probation: { drive_id: 'OLD_ID', file_name: 'thu-viec.pdf', mime_type: 'application/pdf', size: 10, uploaded_at: '2026-11-01T00:00:00.000Z', uploaded_by: 'HR1', storage: 'DRIVE' },
    },
    version: 2,
  };
  const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

  const repo: any = {
    syncService: {
      isDriveReady: () => true,
      uploadEmployeeProfileToDrive: async () => ({ fileId: 'DRIVE_ID_OFFICIAL' }),
    },
    getEmployeeById: async () => emp,
    updateEmployee: async (_id: string, patch: any) => { Object.assign(emp, patch); return emp; },
    recordAuditLog: async () => undefined,
  };

  const svc = new EmployeesService(repo);
  const r = await svc.saveContract(
    empId,
    { kind: 'OFFICIAL', fileName: 'hop-dong-chinh-thuc.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: docx.toString('base64') },
    empId,
  );

  assert.equal(r.meta.storage, 'DRIVE');
  assert.equal((emp.contract_docs as any).official.drive_id, 'DRIVE_ID_OFFICIAL');
  assert.equal((emp.contract_docs as any).probation.drive_id, 'OLD_ID', 'hợp đồng thử việc cũ phải còn nguyên');

  removeContractDisk(empId, 'OFFICIAL');
});
