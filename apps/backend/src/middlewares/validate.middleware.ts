import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export interface ValidateSchemas {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

/**
 * Validate body/query/params bằng zod. Dữ liệu đã validate (kèm default)
 * được gán lại vào req để handler dùng tiếp như cũ.
 * Thất bại -> 400 { error: 'VALIDATION_ERROR', details: [...] }.
 */
export function validate(schemas: ValidateSchemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body ?? {});
      }
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        (req as any).query = parsed;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as any;
      }
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const details = err.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        // Log chi tiết để debug form admin (trước đây chỉ trả code chung).
        console.warn(`[validate] ${req.method} ${req.path} FAILED:`, JSON.stringify(details));
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Dữ liệu gửi lên không hợp lệ',
          details,
        });
      }
      next(err);
    }
  };
}
