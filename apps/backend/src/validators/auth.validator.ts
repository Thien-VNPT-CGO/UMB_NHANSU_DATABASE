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

// Kiểm tra SĐT có tồn tại trong CSDL không (bước 1 luồng đăng nhập, chưa cần PIN).
export const checkPhoneBody = z.object({
  phone: z.string().trim().min(9).max(15),
});

export const refreshBody = z.object({
  refreshToken: z.string().min(10).max(8192),
});

export const changePasswordBody = z.object({
  oldPassword: z.string().min(1).max(128),
  // Khớp giới hạn bcrypt (72 bytes) + chính sách tối thiểu 6 ký tự.
  newPassword: z.string().min(6).max(72),
});

// PIN cũ: chấp nhận 4-8 chữ số để tài khoản legacy vẫn đổi được lần cuối.
// PIN mới: bắt buộc đúng 6 chữ số (ràng buộc từ 2026-10).
const oldPinFormat = z.string().trim().regex(/^\d{4,8}$/, 'Mã PIN cũ gồm 4-8 chữ số');
const newPinFormat = z.string().trim().regex(/^\d{6}$/, 'Mã PIN mới phải đúng 6 chữ số');

export const employeeChangePinBody = z.object({
  oldPin: oldPinFormat,
  newPin: newPinFormat,
});
