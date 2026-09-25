import { Request, Response, NextFunction } from 'express';
import { AuthUser, ERROR_CODES } from '@ubm/shared';
import { AuthService } from '../services/auth.service.js';
import { ISheetsRepository } from '../repositories/sheets.interface.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'UNAUTHORIZED';
}

/**
 * Factory: middleware xác thực có kiểm tra revoke qua DB (version/is_active).
 * Phải dùng factory này trong app (createAuthMiddleware(adapter)).
 */
export function createAuthMiddleware(repo: ISheetsRepository) {
  const authService = new AuthService(repo);

  return async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Thiếu Authorization Bearer token',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Thiếu Authorization Bearer token',
      });
    }

    try {
      const verified = await authService.verifyAccessToken(token);
      const { tv: _tv, ...user } = verified;
      req.user = user;
      next();
    } catch (error) {
      const msg = errorMessage(error);
      if (msg === 'TOKEN_EXPIRED') {
        return res.status(401).json({
          error: ERROR_CODES.UNAUTHORIZED,
          message: 'Token đã hết hạn, vui lòng đăng nhập lại hoặc dùng refresh token',
          code: 'TOKEN_EXPIRED',
        });
      }
      if (msg === 'TOKEN_REVOKED' || msg === 'ACCOUNT_REVOKED' || msg === 'REFRESH_REVOKED') {
        return res.status(401).json({
          error: ERROR_CODES.UNAUTHORIZED,
          message: 'Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại',
          code: msg,
        });
      }
      return res.status(401).json({
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Token không hợp lệ hoặc đã hết hạn',
      });
    }
  };
}

// Giữ export cũ để không gãy import ở nơi khác, nhưng mặc định từ chối
// vì thiếu repo để kiểm tra revoke. Mọi route trong app phải dùng factory.
export function authMiddleware(_req: AuthenticatedRequest, res: Response, _next: NextFunction) {
  return res.status(500).json({
    error: ERROR_CODES.UNAUTHORIZED,
    message: 'Auth middleware chưa được khởi tạo với repository (dùng createAuthMiddleware)',
  });
}
