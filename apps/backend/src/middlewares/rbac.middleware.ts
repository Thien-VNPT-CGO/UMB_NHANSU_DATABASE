import { Response, NextFunction } from 'express';
import { ERROR_CODES, SystemRole, UserPermission } from '@ubm/shared';
import { AuthenticatedRequest } from './auth.middleware.js';

export function requireRole(allowedRoles: SystemRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: ERROR_CODES.UNAUTHORIZED });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: ERROR_CODES.FORBIDDEN,
        message: `Tài khoản vai trò ${req.user.role} không có quyền thực hiện tác vụ này.`,
      });
    }

    next();
  };
}

export function requirePermission(permission: UserPermission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: ERROR_CODES.UNAUTHORIZED });
    }

    // ADMIN has all permissions
    if (req.user.role === 'ADMIN') {
      return next();
    }

    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({
        error: ERROR_CODES.FORBIDDEN,
        message: `Yêu cầu quyền ${permission} để thực hiện thao tác.`,
      });
    }

    next();
  };
}

export function enforceBranchScope(getBranchId: (req: AuthenticatedRequest) => string | undefined) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: ERROR_CODES.UNAUTHORIZED });
    }

    const targetBranch = getBranchId(req);
    if (!targetBranch) {
      return next();
    }

    // Wildcard scope can access all branches
    if (req.user.branchScope === '*' || req.user.role === 'ADMIN' || req.user.role === 'HR' || req.user.role === 'FINANCE') {
      return next();
    }

    if (req.user.branchScope !== targetBranch) {
      return res.status(403).json({
        error: ERROR_CODES.BRANCH_SCOPE_VIOLATION,
        message: `Bạn chỉ có quyền thao tác trên chi nhánh ${req.user.branchScope}, không thể truy cập ${targetBranch}.`,
      });
    }

    next();
  };
}
