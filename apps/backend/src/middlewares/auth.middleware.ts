import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthUser, ERROR_CODES } from '@ubm/shared';
import { JWT_SECRET } from '../services/auth.service.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: ERROR_CODES.UNAUTHORIZED,
      message: 'Thiếu Authorization Bearer token',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: decoded.sub,
      employeeId: decoded.employeeId,
      role: decoded.role,
      branchScope: decoded.branchScope || '*',
      phone: decoded.phone || '',
      fullName: decoded.fullName || '',
      permissions: decoded.permissions || [],
    };
    next();
  } catch (error) {
    return res.status(401).json({
      error: ERROR_CODES.UNAUTHORIZED,
      message: 'Token không hợp lệ hoặc đã hết hạn',
    });
  }
}
