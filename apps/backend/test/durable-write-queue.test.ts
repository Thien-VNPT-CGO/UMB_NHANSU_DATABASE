import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DurableWriteQueue } from '../src/repositories/durable-write-queue.js';

async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fn()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Hết thời gian chờ điều kiện test');
}

test('durable queue retry thành công sau lỗi tạm thời', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-durable-'));
  const file = path.join(dir, 'pending-writes.json');
  let calls = 0;
  const queue = new DurableWriteQueue({
    append: async () => {
      calls += 1;
      return calls >= 2;
    },
    filePath: file,
    maxAttempts: 3,
    retryBaseMs: 25,
  });
  try {
    await queue.enqueue('SU_KIEN_DIEM_DANH', [['event-1']]);
    await waitFor(() => queue.getStats().pending === 0 && queue.getStats().processing === false && calls >= 2);
    assert.equal(queue.getStats().deadLetters, 0);
    assert.equal(queue.getStats().lastSuccessAt !== null, true);
  } finally {
    queue.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('durable queue chuyển dead-letter và nạp lại sau restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-durable-dead-'));
  const file = path.join(dir, 'pending-writes.json');
  const queue = new DurableWriteQueue({
    append: async () => false,
    filePath: file,
    maxAttempts: 1,
    retryBaseMs: 25,
  });
  try {
    await queue.enqueue('THONGBAO_NV', [['inbox-1']]);
    await waitFor(() => queue.getStats().deadLetters === 1 && queue.getStats().processing === false);

    const reloaded = new DurableWriteQueue({
      append: async () => true,
      filePath: file,
      maxAttempts: 1,
      retryBaseMs: 25,
    });
    try {
      assert.equal(reloaded.getStats().deadLetters, 1);
      assert.match(reloaded.getDeadLetters(1)[0].lastError || '', /APPEND_FAILED/);
    } finally {
      reloaded.stop();
    }
  } finally {
    queue.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('durable queue giữ pending trên đĩa khi chưa gửi được', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-durable-reload-'));
  const file = path.join(dir, 'pending-writes.json');
  const queue = new DurableWriteQueue({
    append: async () => false,
    filePath: file,
    maxAttempts: 10,
    retryBaseMs: 60_000,
  });
  try {
    await queue.enqueue('DIEU_CHINH_CONG', [['adjustment-1']]);
    await waitFor(() => queue.getStats().pending === 1 && queue.getStats().processing === false);
    const reloaded = new DurableWriteQueue({
      append: async () => true,
      filePath: file,
      maxAttempts: 10,
    });
    try {
      assert.equal(reloaded.getStats().pending, 1);
      assert.equal(reloaded.getStats().deadLetters, 0);
    } finally {
      reloaded.stop();
    }
  } finally {
    queue.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
