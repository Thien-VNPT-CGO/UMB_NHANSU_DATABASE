/**
 * Bộ TIÊU CHÍ LỌC HỒ SƠ / chấm phỏng vấn UBM (mirror backend interview-rubric.service).
 * PASS từ 12 điểm (MAX 13); đáp án LOẠI / LOẠI THẲNG loại thẳng.
 */

export interface RubricOption {
  label: string;
  score?: number;
  loai?: boolean;
}

export interface RubricQuestion {
  id: string;
  text: string;
  cond?: string;
  multi?: boolean;
  options: RubricOption[];
}

export interface Rubric {
  id: 'store' | 'office';
  name: string;
  passScore: number;
  maxScore: number;
  questions: RubricQuestion[];
}

export const INTERVIEW_RUBRICS: Rubric[] = [
  {
    id: 'store',
    name: 'Cửa hàng (9 câu)',
    passScore: 12,
    maxScore: 13,
    questions: [
      {
        id: 's1',
        text: 'Anh thấy em đã có kinh nghiệm làm việc tại... Vị trí em làm việc cụ thể, em quen quy trình làm việc tại thương hiệu đó?',
        options: [
          { label: 'Không trả lời được / Không trung thực', loai: true },
          { label: 'Chỉ trả lời qua loa được 1 công việc', score: 1 },
          { label: 'Trả lời rành mạch các bước đã từng làm', score: 2 },
        ],
      },
      {
        id: 's2',
        text: 'Lý do vì sao em nghỉ việc?',
        options: [
          { label: 'Trả lời tiêu cực, phê phán công ty cũ', loai: true },
          { label: 'Trả lời nửa vời, không tích cực, không tiêu cực', score: 1 },
          { label: 'Trả lời theo hướng tích cực, không đổ lỗi', score: 2 },
        ],
      },
      {
        id: 's3',
        text: 'Chia sẻ tình huống em đã từng khó xử ở công ty cũ và cách giải quyết?',
        options: [
          { label: 'Không trả lời được', score: 0 },
          { label: 'Trả lời sơ sài', score: 0 },
          { label: 'Trả lời rành mạch', score: 1 },
        ],
      },
      {
        id: 's4',
        text: 'Bạn có hay tham gia sự kiện tình nguyện, văn nghệ hay câu lạc bộ ở trường không?',
        cond: 'NẾU ỨNG VIÊN LÀ SINH VIÊN',
        options: [
          { label: 'Ưu tiên các bạn hướng ngoại, có tham gia', score: 2 },
          { label: 'Không tham gia, hoặc có nhưng ít nói, thái độ rụt rè', score: 0 },
        ],
      },
      {
        id: 's5',
        text: 'Bạn có sở thích gì? (Như đi cà phê cùng bạn hay đọc sách)',
        cond: 'NẾU ỨNG VIÊN KHÔNG BẰNG CẤP ĐI LÀM',
        options: [
          { label: 'Hướng ngoại — thích nơi đông người, vận động, hoạt động đội nhóm', score: 1 },
          { label: 'Hướng nội solo (đọc sách, game, thể thao cá nhân...)', loai: true },
        ],
      },
      {
        id: 's6',
        text: 'Ngoại hình, tác phong',
        options: [
          { label: 'Mặt căng, không chào hỏi', loai: true },
          { label: 'Mặt hiền hậu, vui vẻ, tóc tai gọn gàng', score: 1 },
          { label: 'Giọng nói dễ nghe, nhẹ nhàng', score: 1 },
        ],
      },
      {
        id: 's7',
        text: 'Nếu khách mua 1 chai, làm cách nào up-sale khách lên được 5 chai?',
        options: [
          { label: 'Không trả lời được', score: 0 },
          { label: 'Trả lời sơ sài', score: 0 },
          { label: 'Trả lời chi tiết, cụ thể rõ ràng', score: 1 },
        ],
      },
      {
        id: 's8',
        text: 'Nếu vị sữa hôm đó hết hàng, em sẽ tư vấn như thế nào để khách mua vị sữa khác?',
        options: [
          { label: 'Không trả lời được', score: 0 },
          { label: 'Trả lời chi tiết, cụ thể rõ ràng', score: 2 },
        ],
      },
      {
        id: 's9',
        text: 'Em có câu thắc mắc gì về công việc không?',
        options: [
          { label: 'Có hỏi', score: 1 },
          { label: 'Không hỏi gì hết', score: 0 },
        ],
      },
    ],
  },
  {
    id: 'office',
    name: 'Văn phòng / Khối khác (7 câu)',
    passScore: 12,
    maxScore: 13,
    questions: [
      {
        id: 'o1',
        text: 'Em hãy tự nhận xét về chính bản thân: em có điểm mạnh và điểm yếu gì?',
        options: [
          { label: 'Khoe điểm mạnh quá nhiều / không trung thực với chính mình', loai: true },
          { label: 'Chỉ trả lời qua loa', score: 1 },
          { label: 'Trả lời rành mạch, chia sẻ nhiều điểm yếu và cách khắc phục', score: 2 },
        ],
      },
      {
        id: 'o2',
        text: 'Bị đổ oan copy bài thi, thầy/cô mặc định em là người copy và em bị mất điểm oan. Em sẽ làm gì?',
        options: [
          { label: 'Trả lời tiêu cực, phê phán thầy/cô, người copy', loai: true },
          { label: 'Trả lời nửa vời, không tích cực, không tiêu cực', score: 1 },
          { label: 'Trả lời theo hướng tích cực, không đổ lỗi', score: 2 },
        ],
      },
      {
        id: 'o3',
        text: 'Chia sẻ tình huống khó xử / bất đồng quan điểm với bạn bè / thầy cô và cách giải quyết?',
        options: [
          { label: 'Không trả lời được', score: 0 },
          { label: 'Trả lời sơ sài', score: 1 },
          { label: 'Trả lời rành mạch', score: 2 },
        ],
      },
      {
        id: 'o4',
        text: 'Ngoại hình, tác phong',
        multi: true,
        options: [
          { label: 'Mặt căng, không chào hỏi', loai: true },
          { label: 'Mặt hiền hậu, vui vẻ, tóc tai gọn gàng', score: 1 },
          { label: 'Giọng nói dễ nghe, nhẹ nhàng', score: 1 },
        ],
      },
      {
        id: 'o5',
        text: 'Nếu khách mua 1 chai, làm cách nào up-sale khách lên được 5 chai?',
        options: [
          { label: 'Không trả lời được', score: 0 },
          { label: 'Trả lời sơ sài', score: 1 },
          { label: 'Trả lời chi tiết, cụ thể rõ ràng', score: 2 },
        ],
      },
      {
        id: 'o6',
        text: 'Nếu vị sữa hôm đó hết hàng, em sẽ tư vấn như thế nào để khách mua vị khác?',
        options: [
          { label: 'Không trả lời được', score: 0 },
          { label: 'Trả lời sơ sài', score: 1 },
          { label: 'Trả lời chi tiết, cụ thể rõ ràng', score: 2 },
        ],
      },
      {
        id: 'o7',
        text: 'Em có câu thắc mắc gì về công việc không?',
        options: [
          { label: 'Có hỏi', score: 1 },
          { label: 'Không hỏi gì hết', score: 0 },
        ],
      },
    ],
  },
];

export interface RubricScore {
  total: number;
  max: number;
  hasLoai: boolean;
  passed: boolean;
  verdict: 'PASS' | 'CONSIDER' | 'FAIL' | 'LOAI';
}

/** Tính điểm live từ đáp án đã chọn. */
export function computeRubricClient(rubricId: string, answers: Record<string, number[]>): RubricScore {
  const rubric = INTERVIEW_RUBRICS.find(r => r.id === rubricId);
  if (!rubric) return { total: 0, max: 13, hasLoai: false, passed: false, verdict: 'FAIL' };
  let total = 0;
  let hasLoai = false;
  for (const q of rubric.questions) {
    const picked = answers?.[q.id] || [];
    const useIdx = q.multi ? picked : picked.slice(0, 1);
    for (const idx of useIdx) {
      const opt = q.options[idx];
      if (!opt) continue;
      if (opt.loai) hasLoai = true;
      else total += opt.score || 0;
    }
  }
  let verdict: RubricScore['verdict'];
  if (hasLoai) verdict = 'LOAI';
  else if (total >= rubric.passScore) verdict = 'PASS';
  else if (total >= 10) verdict = 'CONSIDER';
  else verdict = 'FAIL';
  return { total, max: rubric.maxScore, hasLoai, passed: verdict === 'PASS', verdict };
}

/** Parse chi tiết chấm đã lưu trên hồ sơ. */
export function parseScoreDetailClient(raw: unknown): (RubricScore & { rubricId?: string; answers?: any }) | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw);
    if (typeof o?.total !== 'number') return null;
    return o;
  } catch {
    return null;
  }
}

/** Trạng thái ứng viên -> tiếng Việt (dùng cho cả 2 tab). */
export function candStatusVI(s: unknown): string {
  const vi: Record<string, string> = {
    NEW: 'Mới ứng tuyển',
    NEED_INFO: 'Cần bổ sung',
    INVITED_INTERVIEW: 'Đã mời phỏng vấn',
    INTERVIEWED: 'Đã phỏng vấn',
    ACCEPTED: 'Đã duyệt chính thức',
    REJECTED: 'Đã loại',
  };
  const k = String(s || '').trim();
  return vi[k] || k || 'Mới ứng tuyển';
}
