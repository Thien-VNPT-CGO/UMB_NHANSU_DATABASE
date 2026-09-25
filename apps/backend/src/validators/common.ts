import { z } from 'zod';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Chuỗi id/path param: bắt buộc, đã trim, chống payload khổng lồ. */
export const shortId = (max = 64) => z.string().trim().min(1).max(max);

export const idParams = z.object({ id: shortId() });

/** Optimistic-locking version: query/body gửi string vẫn parse được. */
export const expectedVersion = z.coerce.number().int().min(1).max(1_000_000_000).default(1);

/** Ngày YYYY-MM-DD trong query: chỉ check khi client gửi, handler giữ default. */
export const dateQuery = z.string().trim().min(1).max(32).optional();

/** Chuỗi ngắn trong query (branchId, employeeId, filter...). */
export const queryString = (max = 64) => z.string().trim().max(max).optional();

export const optString = (max = 500) => z.string().trim().max(max).optional();

export const latField = z.coerce.number().min(-90).max(90).optional();
export const lngField = z.coerce.number().min(-180).max(180).optional();
export const accuracyField = z.coerce.number().min(0).max(100_000).optional();

export const gpsObject = z
  .object({
    latitude: latField,
    longitude: lngField,
    accuracy: accuracyField,
  })
  .passthrough()
  .optional();

/** Ảnh base64: giới hạn dưới trần JSON 2MB để không nuốt RAM. */
export const photoField = z.string().max(2_000_000).optional();

/**
 * Body object mở (cấu hình chi nhánh, policies, templates...):
 * chỉ chặn string/number/array gửi nhầm, không strip field lạ.
 */
export const openObjectBody = z
  .unknown()
  .refine(v => typeof v === 'object' && v !== null, {
    message: 'Body phải là object',
  });
