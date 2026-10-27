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

test('durable queue gộp nhiều bản ghi cùng tab vào 1 lần append', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-durable-batch-'));
  const file = path.join(dir, 'pending-writes.json');
  let release: (() => void) | null = null;
  const gate = new Promise<void>(r => { release = r; });
  const calls: Array<{ tab: string; rows: number }> = [];
  const queue = new DurableWriteQueue({
    append: async (tab, rows) => {
      calls.push({ tab, rows: rows.length });
      if (calls.length === 1) await gate; // giữ lượt đầu để các bản ghi sau kịp vào hàng đợi
      return true;
    },
    filePath: file,
    retryBaseMs: 25,
    batchMaxEntries: 100,
    batchMaxRows: 500,
  });
  try {
    // Lượt đầu bị chặn → enqueue thêm 29 bản ghi cùng tab.
    const first = queue.enqueue('THONGBAO_NV', [['inbox-0']]);
    await waitFor(() => calls.length === 1);
    const rest: Array<Promise<string>> = [];
    for (let i = 1; i <= 29; i++) rest.push(queue.enqueue('THONGBAO_NV', [[`inbox-${i}`]]));
    rest.push(queue.enqueue('SU_KIEN_DIEM_DANH', [['event-1']]));
    await Promise.all([first, ...rest]);
    release!();
    await waitFor(() => queue.getStats().pending === 0 && queue.getStats().processing === false, 5000);

    assert.deepEqual(
      calls.filter(c => c.tab === 'THONGBAO_NV').map(c => c.rows),
      [1, 29],
      '29 bản ghi cùng tab phải gộp vào đúng 1 request'
    );
    assert.equal(calls.filter(c => c.tab === 'SU_KIEN_DIEM_DANH').length, 1);
    assert.equal(queue.getStats().deadLetters, 0);
  } finally {
    queue.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('durable queue ưu tiên dữ liệu nghiệp vụ trước tab thông báo khi tồn đọng', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-durable-prio-'));
  const file = path.join(dir, 'pending-writes.json');
  let release: (() => void) | null = null;
  const gate = new Promise<void>(r => { release = r; });
  const order: string[] = [];
  const queue = new DurableWriteQueue({
    append: async (tab) => {
      order.push(tab);
      if (order.length === 1) await gate;
      return true;
    },
    filePath: file,
    retryBaseMs: 25,
    priorityThreshold: 1,
  });
  try {
    const first = queue.enqueue('THONGBAO_NV', [['inbox-0']]);
    await waitFor(() => order.length === 1);
    const rest = [
      queue.enqueue('SU_KIEN_DIEM_DANH', [['event-1']]),
      queue.enqueue('THONGBAO_NV', [['inbox-1']]),
    ];
    await Promise.all([first, ...rest]);
    release!();
    await waitFor(() => queue.getStats().pending === 0 && queue.getStats().processing === false, 5000);
    assert.deepEqual(order, ['THONGBAO_NV', 'SU_KIEN_DIEM_DANH', 'THONGBAO_NV']);
  } finally {
    queue.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('durable queue tạm nghỉ toàn cục khi NHIỀU tab cùng lỗi liên tiếp', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-durable-pause-'));
  const file = path.join(dir, 'pending-writes.json');
  let calls = 0;
  const queue = new DurableWriteQueue({
    append: async () => {
      calls += 1;
      return false;
    },
    filePath: file,
    maxAttempts: 50,
    retryBaseMs: 25,
    failureStreakLimit: 2,
    pauseMs: 60_000,
  });
  try {
    // Hai tab cùng hỏng = sự cố diện rộng → nghỉ toàn hàng đợi.
    await queue.enqueue('THONGBAO_NV', [['inbox-1']]);
    await queue.enqueue('SU_KIEN_DIEM_DANH', [['event-1']]);
    await waitFor(() => queue.getStats().pausedUntil !== null && queue.getStats().processing === false);
    assert.ok(calls >= 3, 'phải thử cả 2 tab trước khi nghỉ toàn cục');
    const before = calls;
    await new Promise(r => setTimeout(r, 300));
    assert.equal(calls, before, 'trong thời gian nghỉ không gọi Google thêm');
    assert.ok(queue.getStats().pausedUntil);
  } finally {
    queue.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('durable queue hoãn RIÊNG tab lỗi, tab khác vẫn ghi được', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubm-durable-tabiso-'));
  const file = path.join(dir, 'pending-writes.json');
  const okTabs: string[] = [];
  let badCalls = 0;
  const queue = new DurableWriteQueue({
    append: async (tab) => {
      if (tab === 'THONGBAO_NV') {
        badCalls += 1;
        throw new Error('The operation was aborted.');
      }
      okTabs.push(tab);
      return true;
    },
    filePath: file,
    maxAttempts: 50,
    retryBaseMs: 25,
    failureStreakLimit: 2,
    tabBackoffMs: 60_000,
  });
  try {
    await queue.enqueue('THONGBAO_NV', [['inbox-1']]);
    await queue.enqueue('SU_KIEN_DIEM_DANH', [['event-1']]);
    await waitFor(() => okTabs.length === 1 && !!queue.getStats().tabBackoffs.THONGBAO_NV, 5000);
    // Tab hỏng bị hoãn riêng, KHÔNG nghỉ toàn hàng đợi.
    assert.equal(queue.getStats().pausedUntil, null);
    assert.ok(queue.getStats().tabBackoffs.THONGBAO_NV, 'tab lỗi phải có mốc thử lại riêng');
    assert.ok(badCalls >= 1);
    const before = badCalls;
    await new Promise(r => setTimeout(r, 300));
    assert.equal(badCalls, before, 'tab đang bị hoãn không được gọi lại liên tục');
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
