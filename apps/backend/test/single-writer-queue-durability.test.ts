import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SingleWriterQueue } from '../src/repositories/single-writer-queue.js';

test('single writer chuyển lỗi nghiệp vụ sang dead-letter và giữ qua restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-sw-dead-'));
  const file = path.join(dir, 'journal.json');
  try {
    const queue = new SingleWriterQueue({ journalPath: file, maxRetries: 0 });
    await assert.rejects(
      queue.enqueue({
        entityType: 'EMPLOYEE',
        entityId: 'EMP_1',
        actorId: 'ADMIN_1',
        execute: async () => { throw new Error('VALIDATION_FAILED'); },
      }),
      /VALIDATION_FAILED/,
    );
    assert.equal(queue.getDurabilityStatus().deadLetters, 1);
    assert.equal(queue.getDeadLetters(1)[0].error, 'VALIDATION_FAILED');

    const reloaded = new SingleWriterQueue({ journalPath: file, maxRetries: 0 });
    assert.equal(reloaded.getDurabilityStatus().deadLetters, 1);
    assert.equal(reloaded.getPendingCount(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('single writer phục hồi task dở dang thành dead-letter ORPHANED_ON_RESTART', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-sw-orphan-'));
  const file = path.join(dir, 'journal.json');
  try {
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      pending: [{
        operationId: 'op-orphan',
        idempotencyKey: 'key-orphan',
        entityType: 'SHIFT',
        entityId: 'SHIFT_1',
        actorId: 'ADMIN_1',
        state: 'RUNNING',
        enqueuedAt: new Date().toISOString(),
        attempts: 1,
      }],
      deadLetters: [],
    }));

    const queue = new SingleWriterQueue({ journalPath: file, maxRetries: 0 });
    const dead = queue.getDeadLetters(10);
    assert.equal(dead.length, 1);
    assert.equal(dead[0].operationId, 'op-orphan');
    assert.equal(dead[0].error, 'ORPHANED_ON_RESTART');
    assert.equal(queue.getPendingCount(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('single writer retry lỗi timeout có idempotencyKey rồi thành công', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-sw-retry-'));
  const file = path.join(dir, 'journal.json');
  try {
    let calls = 0;
    const queue = new SingleWriterQueue({ journalPath: file, maxRetries: 1, retryBaseMs: 25 });
    const result = await queue.enqueue({
      idempotencyKey: 'key-retry',
      entityType: 'ATTENDANCE',
      entityId: 'EVENT_1',
      actorId: 'EMP_1',
      execute: async () => {
        calls += 1;
        if (calls === 1) throw new Error('SHEETS_TIMEOUT:append.SU_KIEN_DIEM_DANH');
        return { ok: true };
      },
    });
    assert.equal(calls, 2);
    assert.deepEqual(result.result, { ok: true });
    assert.equal(queue.getDurabilityStatus().deadLetters, 0);
    assert.equal(queue.getPendingCount(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
