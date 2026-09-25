import { z } from 'zod';
import { idParams, openObjectBody, optString } from './common.js';

// --- Internal accounts ---
// Frontend gửi plaintext trong field `password` hoặc alias `password_hash`.
const passwordInput = z.string().min(1).max(5000);

export const internalAccountCreateBody = z
  .object({
    admin_id: optString(64),
    username: z.string().trim().min(3).max(64),
    password: passwordInput.optional(),
    password_hash: passwordInput.optional(),
    full_name: optString(100),
    role: optString(32),
    branch_scope: optString(32),
    is_active: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    const plain = v.password ?? v.password_hash;
    if (!plain) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Thiếu mật khẩu', path: ['password'] });
      return;
    }
    if (plain.length < 6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mật khẩu tối thiểu 6 ký tự', path: ['password'] });
    }
  });

export const internalAccountUpdateBody = z
  .object({
    password: passwordInput.optional(),
    password_hash: passwordInput.optional(),
    username: z.string().trim().min(3).max(64).optional(),
    full_name: optString(100),
    role: optString(32),
    branch_scope: optString(32),
    is_active: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    const plain = v.password ?? v.password_hash;
    if (typeof plain === 'string' && plain.length > 0 && plain.length < 6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mật khẩu tối thiểu 6 ký tự', path: ['password'] });
    }
  });

// --- Opaque admin configs (branches, templates, policies, maintenance, settings) ---
export const opaqueConfigBody = openObjectBody;

// --- Backup ---
export const backupCreateBody = z.object({
  name: optString(100),
});
export const testRecoveryBody = z.object({
  snapshot_id: z.string().trim().min(1).max(128),
});

// HR cấp/reset mã PIN đăng nhập cho nhân viên (4-8 chữ số).
export const setEmployeePinBody = z.object({
  pin: z.string().trim().regex(/^\d{4,8}$/, 'Mã PIN gồm 4-8 chữ số'),
});

export { idParams };
