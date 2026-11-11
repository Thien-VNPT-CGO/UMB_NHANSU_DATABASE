/**
 * Quy tắc chấm điểm cột "Năm Sinh" của AI chấm điểm hồ sơ ứng viên.
 *
 * Điểm được tính theo ĐỘ TUỔI THẬT tại thời điểm chấm (không hard-code năm,
 * không dùng mốc "2000-2004" cố định — sang năm mới tuổi và điểm tự cập nhật):
 *   - Dưới 18 tuổi        → 0 điểm
 *   - Từ 18 đến dưới 20   → 1 điểm
 *   - Từ 20 tuổi trở lên  → 2 điểm
 *
 * Dữ liệu Google Form chỉ có NĂM SINH (có thể là khoảng "2004 - 2008"), nên
 * tuổi = năm hiện tại (giờ Việt Nam) − năm sinh. Thiếu/không đọc được năm sinh
 * thì KHÔNG cộng điểm (trước đây tự gán 2002 sẽ cộng điểm oan cho hồ sơ trống).
 */

export interface CandidateAgeEvaluation {
  /** Năm hiện tại theo múi giờ Việt Nam tại thời điểm chấm. */
  currentYear: number;
  /** Năm sinh đã chuẩn hoá; null khi không đọc được. */
  birthYear: number | null;
  /** Tuổi thật (theo năm); null khi không đọc được năm sinh. */
  age: number | null;
  /** Điểm tiêu chí 2 (Năm sinh). */
  points: 0 | 1 | 2;
  /** Ghi chú hiển thị trong bảng ma trận 9 tiêu chí. */
  note: string;
}

/** Năm hiện tại theo giờ Việt Nam — không phụ thuộc timezone máy chủ/máy HR. */
export function vietnamCurrentYear(now: Date = new Date()): number {
  try {
    const y = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(now),
      10,
    );
    if (Number.isFinite(y) && y > 1900) return y;
  } catch {
    /* Intl không hỗ trợ timezone -> dùng năm của máy */
  }
  return now.getFullYear();
}

/**
 * Đọc năm sinh từ dữ liệu Form:
 *  - số (birth_year đã suy ra)             → dùng trực tiếp
 *  - "1999", "Năm 1999"                    → 1999
 *  - khoảng tuổi "2004 - 2008", "2008 trở lên" → lấy nhóm 4 số CUỐI (giữ hành
 *    vi cũ của parseFormBirthYear, tức năm trẻ nhất trong khoảng → không chấm
 *    điểm cao hơn thực tế).
 * Trả null nếu không có năm hợp lệ.
 */
export function parseBirthYearValue(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 1900 ? Math.trunc(raw) : null;
  }
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const years = text.match(/\d{4}/g);
  if (!years || years.length === 0) return null;
  const last = Number(years[years.length - 1]);
  return Number.isFinite(last) && last >= 1900 ? last : null;
}

/** Tuổi + điểm cột Năm Sinh theo năm hiện tại thật (giờ VN). */
export function evaluateCandidateAge(rawBirth: unknown, now: Date = new Date()): CandidateAgeEvaluation {
  const currentYear = vietnamCurrentYear(now);
  const birthYear = parseBirthYearValue(rawBirth);
  if (birthYear === null || birthYear > currentYear) {
    return {
      currentYear,
      birthYear: null,
      age: null,
      points: 0,
      note: 'Chưa xác định được năm sinh hợp lệ (0 điểm — không tự đoán tuổi)',
    };
  }
  const age = currentYear - birthYear;
  if (age < 18) {
    return {
      currentYear,
      birthYear,
      age,
      points: 0,
      note: `Sinh năm ${birthYear} — ${age} tuổi (dưới 18 tuổi: 0 điểm)`,
    };
  }
  if (age < 20) {
    return {
      currentYear,
      birthYear,
      age,
      points: 1,
      note: `Sinh năm ${birthYear} — ${age} tuổi (từ 18 đến dưới 20 tuổi: 1 điểm)`,
    };
  }
  return {
    currentYear,
    birthYear,
    age,
    points: 2,
    note: `Sinh năm ${birthYear} — ${age} tuổi (từ 20 tuổi trở lên: 2 điểm)`,
  };
}
