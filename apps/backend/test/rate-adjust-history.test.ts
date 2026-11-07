import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateAdjustService } from '../src/services/rate-adjust.service.js';

/**
 * Lịch sử điều chỉnh đơn giá phải trả bản MỚI NHẤT trước khi cắt `limit`.
 * Trước đây lọc theo 1 nhân viên trả N dòng đầu trong bộ nhớ nên lần điều
 * chỉnh vừa thực hiện không hiện trên bảng lịch sử (tưởng "lưu không ăn").
 */
test('listHistory trả lần điều chỉnh mới nhất trước, bỏ dòng không phải RATE_ADJUST', async () => {
  const repo: any = {
    getStageHistory: async () => [
      { period_id: 'H1', employee_id: 'E1', rate_per_hour: 20000, effective_from: '2026-01-01', note: '[RATE_ADJUST] cũ', created_at: '2026-01-01T00:00:00.000Z' },
      { period_id: 'H2', employee_id: 'E1', rate_per_hour: 25000, effective_from: '2026-06-01', note: 'Chuyển chính thức', created_at: '2026-06-01T00:00:00.000Z' },
      { period_id: 'H3', employee_id: 'E1', rate_per_hour: 30000, effective_from: '2026-10-01', note: '[RATE_ADJUST] mới', created_at: '2026-11-07T07:45:48.000Z' },
    ],
    getEmployeeById: async () => ({ employee_id: 'E1', full_name: 'NGUYỄN PHẠM BẢO CHÂU', employee_code: 'UBM_NV656082' }),
  };
  const svc = new RateAdjustService({ repo, payrollService: {} });

  const rows = await svc.listHistory('E1', 1);

  assert.equal(rows.length, 1, 'limit phải cắt sau khi sắp xếp');
  assert.equal(rows[0].period_id, 'H3');
  assert.equal(rows[0].rate_per_hour, 30000);
});
