/**
 * Hệ thống AI tự động chấm điểm ứng viên đăng ký Google Forms
 * Tuân thủ 100% Ma trận 9 Tiêu chí tuyển dụng chuẩn của UBM:
 * - Thang điểm tối đa (MAXIMUM): 14 điểm
 * - Đạt: >= 8 điểm (và không bị vi phạm tiêu chí Loại)
 * - Loại: < 8 điểm hoặc vi phạm bất kỳ tiêu chí Loại nào
 */

export interface AiScoringResult {
  score: number;
  maxScore: number;
  isDisqualified: boolean;
  disqualifyReason?: string;
  result: 'Đạt' | 'Loại';
  screeningNote: string;
  breakdown: {
    c1_name: { title: string; points: number; max: 1; note: string };
    c2_birth_year: { title: string; points: number; max: 2; note: string };
    c3_hometown: { title: string; points: number; max: 1; note: string };
    c4_phone: { title: string; points: number; max: 1; note: string };
    c5_education: { title: string; points: number; max: 2; note: string };
    c6_experience: { title: string; points: number; max: 2; note: string };
    c7_referral: { title: string; points: number; max: 1; note: string; disqualified?: boolean };
    c8_emergency: { title: string; points: number; max: 2; note: string; disqualified?: boolean };
    c9_facebook: { title: string; points: number; max: 2; note: string; disqualified?: boolean };
  };
}

export function evaluateCandidateAiScore(candidate: {
  full_name?: string;
  birth_year?: number | string;
  hometown?: string;
  phone?: string;
  phone_normalized?: string;
  education_level?: string;
  experience?: string;
  referral_source?: string;
  emergency_handling?: string;
  facebook_url?: string;
}): AiScoringResult {
  const name = (candidate.full_name || '').trim();
  const rawBirth = candidate.birth_year;
  const birthYear = typeof rawBirth === 'number' ? rawBirth : parseInt(String(rawBirth || '').replace(/\D/g, ''), 10) || 2002;
  const hometown = (candidate.hometown || '').trim().toLowerCase();
  const phone = (candidate.phone_normalized || candidate.phone || '').replace(/\D/g, '');
  const education = (candidate.education_level || '').trim().toLowerCase();
  const experience = (candidate.experience || '').trim().toLowerCase();
  const referral = (candidate.referral_source || '').trim().toLowerCase();
  const emergency = (candidate.emergency_handling || '').trim().toLowerCase();
  const facebook = (candidate.facebook_url || '').trim().toLowerCase();

  let isDisqualified = false;
  const disqualifyReasons: string[] = [];

  // --- TIÊU CHÍ 1: Tên bạn là? (Ghi đủ họ và tên -> 1 điểm) ---
  const nameWords = name.split(/\s+/).filter(Boolean);
  let c1Points = 0;
  let c1Note = 'Chưa ghi đủ họ và tên';
  if (nameWords.length >= 2) {
    c1Points = 1;
    c1Note = 'Ghi đủ họ và tên';
  }

  // --- TIÊU CHÍ 2: Năm Sinh của bạn? (2000-2004: 2đ | 2005-2008: 1đ | >2008: 0đ | <2000: 1đ) ---
  let c2Points = 0;
  let c2Note = 'Chưa phù hợp độ tuổi';
  if (birthYear >= 2000 && birthYear <= 2004) {
    c2Points = 2;
    c2Note = `Năm sinh ${birthYear} (2000-2004: Độ tuổi vàng F&B)`;
  } else if (birthYear >= 2005 && birthYear <= 2008) {
    c2Points = 1;
    c2Note = `Năm sinh ${birthYear} (2005-2008)`;
  } else if (birthYear > 2008) {
    c2Points = 0;
    c2Note = `Năm sinh ${birthYear} (Dưới độ tuổi tuyển dụng phổ thông)`;
  } else {
    c2Points = 1;
    c2Note = `Năm sinh ${birthYear} (Trước năm 2000)`;
  }

  // --- TIÊU CHÍ 3: Quê Quán theo CCCD? (Ưu tiên miền Nam, miền Tây: 1đ | Miền Bắc, miền Trung: 0đ) ---
  let c3Points = 0;
  let c3Note = 'Khu vực Miền Bắc / Miền Trung';
  const southKeywords = [
    'hồ chí minh', 'tphcm', 'tp.hcm', 'sài gòn', 'long an', 'tiền giang', 'bến tre',
    'trà vinh', 'vĩnh long', 'đồng tháp', 'an giang', 'kiên giang', 'cần thơ',
    'hậu giang', 'sóc trăng', 'bạc liêu', 'cà mau', 'tây ninh', 'bình dương',
    'bình phước', 'đồng nai', 'vũng tàu', 'bà rịa', 'miền nam', 'miền tây', 'nam bộ'
  ];
  if (southKeywords.some(k => hometown.includes(k))) {
    c3Points = 1;
    c3Note = 'Quê quán Miền Nam / Miền Tây (Ưu tiên)';
  }

  // --- TIÊU CHÍ 4: Số điện thoại của bạn (Số zalo liên hệ)? (Có SĐT hợp lệ: 1đ) ---
  let c4Points = 0;
  let c4Note = 'Số điện thoại không hợp lệ';
  if (phone.length >= 10 && phone.startsWith('0')) {
    c4Points = 1;
    c4Note = `Số điện thoại hợp lệ (${phone})`;
  }

  // --- TIÊU CHÍ 5: Trình độ học vấn? (Đại học/cao đẳng: 1đ | Không đi học chỉ đi làm: 2đ) ---
  let c5Points = 1;
  let c5Note = 'Trình độ Đại học / Cao đẳng / Phổ thông';
  if (/không đi học|chỉ đi làm|đi làm|toàn thời gian|full time|thôi học|nghỉ học|lao động/.test(education)) {
    c5Points = 2;
    c5Note = 'Không đi học chỉ đi làm (Cam kết gắn bó full-time)';
  } else if (/đại học|cao đẳng|sinh viên|đang học|dh|cđ/.test(education)) {
    c5Points = 1;
    c5Note = 'Học vấn Đại học / Cao đẳng';
  }

  // --- TIÊU CHÍ 6: Kinh nghiệm làm việc? (Không có KN: 0đ | KN khác ngoài F&B: 1đ | Từng làm F&B: 2đ) ---
  let c6Points = 0;
  let c6Note = 'Chưa có kinh nghiệm làm việc';
  if (/f&b|pha chế|barista|trà sữa|cà phê|coffee|quán ăn|nhà hàng|bếp|bánh mì|phục vụ|thu ngân quán/.test(experience)) {
    c6Points = 2;
    c6Note = 'Từng có kinh nghiệm làm việc F&B';
  } else if (/có kinh nghiệm|kinh nghiệm khác|từng làm|bảo vệ|shipper|giao hàng|văn phòng|telesale|bán quần áo|shop|part time/.test(experience)) {
    c6Points = 1;
    c6Note = 'Có kinh nghiệm khác ngoài F&B';
  } else if (/không|chưa|mới/.test(experience)) {
    c6Points = 0;
    c6Note = 'Không có kinh nghiệm làm việc';
  }

  // --- TIÊU CHÍ 7: Bạn biết tin ứng tuyển qua hình thức nào? (FB/IG/Tiktok: 1đ | Bạn bè người quen: LOẠI) ---
  let c7Points = 1;
  let c7Note = 'Biết tin qua mạng xã hội (Facebook / Instagram / TikTok)';
  let c7Disqualified = false;
  if (/bạn bè|người quen|giới thiệu|bạn giới thiệu|người thân|anh chị em|nhân viên giới thiệu/.test(referral)) {
    c7Points = 0;
    c7Note = 'Bạn bè / người quen giới thiệu (Tiêu chí LOẠI)';
    c7Disqualified = true;
    isDisqualified = true;
    disqualifyReasons.push('Biết tin qua bạn bè / người quen giới thiệu (Quy định UBM không nhận qua giới thiệu)');
  }

  // --- TIÊU CHÍ 8: Hướng xử lý khi có việc đột xuất trùng ca trực? (Bỏ trống: LOẠI | Đưa ra hướng xử lý: 2đ) ---
  let c8Points = 0;
  let c8Note = 'Bỏ trống hoặc chưa đưa ra hướng xử lý (Tiêu chí LOẠI)';
  let c8Disqualified = false;
  if (!emergency || emergency === '-' || /^(không|k|chưa biết|bỏ|nghỉ|kệ|không biết)$/i.test(emergency)) {
    c8Points = 0;
    c8Disqualified = true;
    isDisqualified = true;
    disqualifyReasons.push('Bỏ trống hướng xử lý khi có việc đột xuất');
  } else {
    c8Points = 2;
    c8Note = 'Đưa ra được hướng xử lý trách nhiệm (báo quản lý, xin đổi ca, sắp xếp trước)';
  }

  // --- TIÊU CHÍ 9: Link Facebook cá nhân? (Không gửi / gửi ảo: 1đ | Facebook thật: 2đ | Drama tiêu cực: LOẠI) ---
  let c9Points = 1;
  let c9Note = 'Không gửi link Facebook hoặc link ảo';
  let c9Disqualified = false;
  if (/drama|tiêu cực|châm biếm|chửi|bóc phốt|toxic|than vãn/.test(facebook)) {
    c9Points = 0;
    c9Note = 'Facebook Drama / nội dung tiêu cực (Tiêu chí LOẠI)';
    c9Disqualified = true;
    isDisqualified = true;
    disqualifyReasons.push('Facebook có nội dung drama / tiêu cực / châm biếm');
  } else if (facebook.includes('facebook.com/') || facebook.includes('fb.com/')) {
    const cleanPath = facebook.replace(/https?:\/\/(www\.)?(facebook\.com|fb\.com)\/?/i, '').replace(/[\/?].*$/, '');
    if (cleanPath.length >= 3 && cleanPath !== 'home' && cleanPath !== 'profile') {
      c9Points = 2;
      c9Note = 'Có gửi liên kết Facebook cá nhân thật';
    } else {
      c9Points = 1;
      c9Note = 'Link Facebook chung chung hoặc chưa xác thực';
    }
  }

  // TỔNG ĐIỂM
  const totalScore = c1Points + c2Points + c3Points + c4Points + c5Points + c6Points + c7Points + c8Points + c9Points;

  // PHÂN LOẠI KẾT QUẢ
  let result: 'Đạt' | 'Loại' = 'Loại';
  let screeningNote = '';

  if (isDisqualified) {
    result = 'Loại';
    screeningNote = `Loại (${disqualifyReasons.join('; ')})`;
  } else if (totalScore >= 8) {
    result = 'Đạt';
    screeningNote = `Đạt (${totalScore}/14 điểm - Đủ điều kiện phỏng vấn)`;
  } else {
    result = 'Loại';
    screeningNote = `Loại (${totalScore}/14 điểm - Dưới 8 điểm chuẩn)`;
  }

  return {
    score: totalScore,
    maxScore: 14,
    isDisqualified,
    disqualifyReason: disqualifyReasons.length > 0 ? disqualifyReasons.join('; ') : undefined,
    result,
    screeningNote,
    breakdown: {
      c1_name: { title: '1. Ghi đủ họ và tên', points: c1Points, max: 1, note: c1Note },
      c2_birth_year: { title: '2. Năm sinh (2000-2004)', points: c2Points, max: 2, note: c2Note },
      c3_hometown: { title: '3. Quê quán (Miền Nam/Tây)', points: c3Points, max: 1, note: c3Note },
      c4_phone: { title: '4. Số điện thoại liên hệ', points: c4Points, max: 1, note: c4Note },
      c5_education: { title: '5. Học vấn / Làm việc', points: c5Points, max: 2, note: c5Note },
      c6_experience: { title: '6. Kinh nghiệm F&B', points: c6Points, max: 2, note: c6Note },
      c7_referral: { title: '7. Nguồn tuyển (Không giới thiệu)', points: c7Points, max: 1, note: c7Note, disqualified: c7Disqualified },
      c8_emergency: { title: '8. Hướng xử lý ca đột xuất', points: c8Points, max: 2, note: c8Note, disqualified: c8Disqualified },
      c9_facebook: { title: '9. Link Facebook (Không drama)', points: c9Points, max: 2, note: c9Note, disqualified: c9Disqualified },
    },
  };
}
