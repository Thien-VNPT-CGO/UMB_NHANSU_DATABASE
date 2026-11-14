import { z } from 'zod';
import { hasVietnameseText, toVietnameseErrorMessage } from '@ubm/shared';

const TYPE_LABELS: Record<string, string> = {
  string: 'chuỗi ký tự',
  number: 'số',
  integer: 'số nguyên',
  boolean: 'đúng/sai',
  array: 'danh sách',
  object: 'đối tượng',
  null: 'rỗng',
  undefined: 'không có giá trị',
  nan: 'số không hợp lệ',
  bigint: 'số lớn',
  date: 'ngày',
  function: 'hàm',
  symbol: 'ký hiệu',
  void: 'rỗng',
};

function typeLabel(value: unknown): string {
  return TYPE_LABELS[String(value || '').toLowerCase()] || 'giá trị hợp lệ';
}

/**
 * Chuyển lỗi Zod (mặc định là tiếng Anh) sang câu tiếng Việt.
 * Giữ nguyên thông báo custom đã viết tiếng Việt trong validator.
 */
export function zodIssueToVietnamese(issue: z.ZodIssue): string {
  if (!issue) return 'Dữ liệu không hợp lệ.';
  if (hasVietnameseText(issue.message)) return issue.message;

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return 'Trường này là bắt buộc.';
      return `Dữ liệu phải là ${typeLabel(issue.expected)}, nhưng nhận được ${typeLabel(issue.received)}.`;

    case z.ZodIssueCode.invalid_literal:
      return 'Giá trị không hợp lệ.';

    case z.ZodIssueCode.invalid_enum_value:
      return 'Giá trị không nằm trong danh sách cho phép.';

    case z.ZodIssueCode.invalid_date:
      return 'Ngày không hợp lệ.';

    case z.ZodIssueCode.invalid_string: {
      const validation = (issue as any).validation;
      if (validation === 'email') return 'Email không hợp lệ.';
      if (validation === 'url') return 'Đường dẫn không hợp lệ.';
      if (validation === 'uuid') return 'Mã định danh không hợp lệ.';
      if (validation === 'regex') return 'Dữ liệu không đúng định dạng.';
      if (validation === 'datetime') return 'Ngày giờ không hợp lệ.';
      if (validation === 'time') return 'Giờ không hợp lệ.';
      if (validation === 'date') return 'Ngày không hợp lệ.';
      if (typeof validation === 'object' && validation?.startsWith) {
        return `Dữ liệu phải bắt đầu bằng "${validation.startsWith}".`;
      }
      if (typeof validation === 'object' && validation?.endsWith) {
        return `Dữ liệu phải kết thúc bằng "${validation.endsWith}".`;
      }
      return 'Dữ liệu không đúng định dạng.';
    }

    case z.ZodIssueCode.too_small: {
      const min = (issue as any).minimum;
      if (issue.type === 'string') {
        return issue.inclusive
          ? `Phải có ít nhất ${min} ký tự.`
          : `Phải có nhiều hơn ${min} ký tự.`;
      }
      if (issue.type === 'array') {
        return issue.inclusive
          ? `Phải có ít nhất ${min} mục.`
          : `Phải có nhiều hơn ${min} mục.`;
      }
      if (issue.type === 'date') return 'Ngày quá nhỏ so với mốc cho phép.';
      return issue.inclusive
        ? `Giá trị phải lớn hơn hoặc bằng ${min}.`
        : `Giá trị phải lớn hơn ${min}.`;
    }

    case z.ZodIssueCode.too_big: {
      const max = (issue as any).maximum;
      if (issue.type === 'string') {
        return issue.inclusive
          ? `Chỉ được tối đa ${max} ký tự.`
          : `Phải có ít hơn ${max} ký tự.`;
      }
      if (issue.type === 'array') {
        return issue.inclusive
          ? `Chỉ được tối đa ${max} mục.`
          : `Phải có ít hơn ${max} mục.`;
      }
      if (issue.type === 'date') return 'Ngày vượt quá mốc cho phép.';
      return issue.inclusive
        ? `Giá trị phải nhỏ hơn hoặc bằng ${max}.`
        : `Giá trị phải nhỏ hơn ${max}.`;
    }

    case z.ZodIssueCode.not_multiple_of:
      return `Giá trị phải là bội số của ${(issue as any).multipleOf}.`;

    case z.ZodIssueCode.not_finite:
      return 'Giá trị số không hợp lệ.';

    case z.ZodIssueCode.unrecognized_keys:
      return 'Dữ liệu chứa trường không được phép.';

    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
    case z.ZodIssueCode.invalid_intersection_types:
      return 'Dữ liệu không khớp với cấu trúc yêu cầu.';

    default: {
      const translated = toVietnameseErrorMessage(issue.message, '');
      return translated || 'Dữ liệu không hợp lệ.';
    }
  }
}
