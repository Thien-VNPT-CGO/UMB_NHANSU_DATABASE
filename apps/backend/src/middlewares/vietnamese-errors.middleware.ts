import { NextFunction, Request, Response } from 'express';
import {
  formatVietnameseErrorDetails,
  toVietnameseErrorMessage,
} from '@ubm/shared';

/**
 * Chuẩn hoá MỌI phản hồi lỗi của Backend sang tiếng Việt.
 *
 * Nhiều route hiện trả `{ error: 'VEHICLE_NOT_FOUND' }` hoặc
 * `{ error: 'SHIFT_NOT_FOUND: ...' }`. Middleware này:
 *  - Giữ nguyên trường `error` (mã lỗi) để client xử lý logic.
 *  - Bổ sung `message` tiếng Việt nếu route chưa có.
 *  - Dịch `message` tiếng Anh (nếu có).
 *  - Dịch từng `details[].message` (lỗi xác thực dữ liệu) sang tiếng Việt.
 *
 * Nhờ vậy cả cổng Admin, cổng Nhân viên và cổng Vi phạm đều nhận thông báo
 * tiếng Việt, không phụ thuộc từng route tự viết message.
 */
export function vietnameseErrorResponses(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  const originalJson = res.json.bind(res) as (body: any) => Response;

  res.json = ((body: any) => {
    try {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const rawError = typeof body.error === 'string' ? body.error.trim() : '';
        const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';

        // Chỉ can thiệp vào phản hồi LỖI (có trường `error`). Phản hồi thành công
        // có thể chứa `message` tiếng Anh hợp lệ (VD health-check) — giữ nguyên.
        if (rawError) {
          const normalized: any = { ...body };
          normalized.message = toVietnameseErrorMessage(rawMessage || rawError);

          if (Array.isArray(body.details)) {
            normalized.details = body.details.map((item: any) => {
              if (!item || typeof item !== 'object') return item;
              return {
                ...item,
                message: toVietnameseErrorMessage(item.message),
              };
            });
          }

          const detailText = formatVietnameseErrorDetails(normalized.details);
          if (detailText && !normalized.message.includes(detailText)) {
            normalized.message = `${normalized.message} — ${detailText}`;
          }

          return originalJson(normalized);
        }
      }
    } catch {
      // Không để việc chuẩn hoá thông báo làm hỏng phản hồi gốc.
    }
    return originalJson(body);
  }) as any;

  next();
}
