import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MockSheetsAdapter } from '../src/repositories/mock-sheets.adapter.js';
import { readRuntimeSnapshot, writeRuntimeSnapshot } from '../src/repositories/runtime-snapshot.js';

test('runtime snapshot roundtrip giữ nhân viên + trạng thái thu hồi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-snapshot-'));
  const file = path.join(dir, 'runtime-snapshot.json');
  try {
    const source = new MockSheetsAdapter();
    source.employees.push({
      employee_id: 'EMP_1',
      employee_code: 'UBM001',
      full_name: 'Nguyễn Văn A',
      employment_status: 'ACTIVE',
    } as any);
    source.terminatedRevoked.add('EMP_1');

    assert.equal(
      await writeRuntimeSnapshot(
        source.exportRuntimeState(),
        {
          signature: 'sig-1',
          tabSignatures: { NHAN_VIEN_MASTER: 'hash-1' },
          pulledAt: '2026-10-23T01:00:00.000Z',
          counts: { employees: 1 },
        },
        file,
      ),
      true,
    );

    const snap = readRuntimeSnapshot(file);
    assert.ok(snap, 'phải đọc lại được snapshot');
    assert.equal(snap.meta.signature, 'sig-1');
    assert.equal(snap.meta.tabSignatures?.NHAN_VIEN_MASTER, 'hash-1');
    assert.equal(snap.meta.counts?.employees, 1);

    const target = new MockSheetsAdapter();
    assert.equal(target.importRuntimeState(snap.state), true);
    assert.equal(target.employees.length, 1);
    assert.equal(target.employees[0].full_name, 'Nguyễn Văn A');
    assert.equal(target.terminatedRevoked.has('EMP_1'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
