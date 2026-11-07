import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsSyncService } from '../src/services/google-sheets-sync.service.js';

/**
 * Regression: backend PHẢI đọc Google Sheets ở chế độ UNFORMATTED_VALUE.
 *
 * Trước đây đọc mặc định FORMATTED_VALUE: ô "Lương Giờ" định dạng tiền tệ
 * trả về chuỗi "30.000 đ" → `Number()` = NaN → 0, nên đơn giá lương ca vừa
 * lưu bị ghi đè về 0 ngay sau lượt pull kế tiếp (mất dữ liệu thật).
 *
 * Ngày/giờ vẫn phải trả chuỗi hiển thị (FORMATTED_STRING) để các hàm chuẩn
 * hoá ngày hiện có tiếp tục hoạt động.
 */

function makeServiceWithFakeClient() {
  const calls: any[] = [];
  const svc: any = new GoogleSheetsSyncService();
  svc.sheetsClient = {
    spreadsheets: {
      values: {
        batchGet: async (params: any) => {
          calls.push({ method: 'batchGet', params });
          return {
            data: {
              valueRanges: (params.ranges || []).map(() => ({ values: [['x']] })),
            },
          };
        },
        get: async (params: any) => {
          calls.push({ method: 'get', params });
          return { data: { values: [['x']] } };
        },
      },
    },
  };
  return { svc, calls };
}

test('readTabsBatch đọc số thô (UNFORMATTED_VALUE) + ngày dạng chuỗi', async () => {
  const { svc, calls } = makeServiceWithFakeClient();

  await svc.readTabsBatch(['LICH_SU_GIAI_DOAN']);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'batchGet');
  assert.equal(calls[0].params.valueRenderOption, 'UNFORMATTED_VALUE');
  assert.equal(calls[0].params.dateTimeRenderOption, 'FORMATTED_STRING');
});

test('readTabRows đọc số thô để đơn giá/tiền lương không bị NaN → 0', async () => {
  const { svc, calls } = makeServiceWithFakeClient();

  await svc.readTabRows('LICH_SU_GIAI_DOAN');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'get');
  assert.equal(calls[0].params.valueRenderOption, 'UNFORMATTED_VALUE');
  assert.equal(calls[0].params.dateTimeRenderOption, 'FORMATTED_STRING');
});
