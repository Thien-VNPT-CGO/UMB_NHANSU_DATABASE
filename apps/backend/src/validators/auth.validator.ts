import { z } from 'zod';

export const phoneLoginBody = z.object({
  phone: z.string().trim().min(9).max(15),
  // Mã PIN 4-8 chữ số do HR cấp. Tài khoản cũ chưa có PIN vẫn gửi kèm (bất kỳ),
  // server trả PIN_NOT_SET để hướng dẫn liên hệ HR.
  pin: z.string().trim().max(12).optional(),
});

export const adminLoginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const refreshBody = z.object({
  refreshToken: z.string().min(10).max(8192),
});

export const changePasswordBody = z.object({
  oldPassword: z.string().min(1).max(128),
  // Khớp giới hạn bcrypt (72 bytes) + chính sách tối thiểu 6 ký tự.
  newPassword: z.string().min(6).max(72),
});

const pinFormat = z.string().trim().regex(/^\d{4,8}$/, 'Mã PIN gồm 4-8 chữ số');

export const employeeChangePinBody = z.object({
  oldPin: pinFormat,
  newPin: pinFormat,
});
