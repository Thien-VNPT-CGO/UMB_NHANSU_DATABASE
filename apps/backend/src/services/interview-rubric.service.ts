/**
 * Bộ TIÊU CHÍ LỌC HỒ SƠ / chấm phỏng vấn UBM (theo 2 bảng giấy của HR):
 *  - 'store': NV cửa hàng — 9 câu, MAX 13.
 *  - 'office': khối còn lại — 7 câu, MAX 13.
 * Quy tắc chung: PASS từ 12 điểm; CÂN NHẮC 10–11; FAIL dưới 10;
 * bất kỳ đáp án LOẠI / LOẠI THẲNG nào cũng loại thẳng.
 */

export interface RubricOption {
  label: string;
  /** Điểm của đáp án (bỏ qua khi loai=true). */
  score?: number;
  /** Đáp án loại thẳng. */
  loai?: boolean;
}

export interface RubricQuestion {
  id: string;
  text: string;
  cond?: string;
  /** true = được chọn nhiều đáp án (cộng dồn điểm). Mặc định chọn 1. */
  multi?: boolean;
  /** Nhóm khóa chéo: trong cùng nhóm chỉ 1 câu được tính (VD sinh viên Q4 khóa Q5 và ngược lại). */
  lockGroup?: string;
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
    name: 'TIÊU CHÍ LỌC HỒ SƠ CÓ KINH NGHIỆM',
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
        cond: 'NẾU ỨNG VIÊN LÀ SINH VIÊN (chọn câu này sẽ khóa Câu 5)',
        lockGroup: 'student-status',
        options: [
          { label: 'Ưu tiên các bạn hướng ngoại, có tham gia', score: 2 },
          { label: 'Không tham gia, hoặc có nhưng ít nói, thái độ rụt rè', score: 0 },
        ],
      },
      {
        id: 's5',
        text: 'Bạn có sở thích gì? (Như đi cà phê cùng bạn hay đọc sách)',
        cond: 'NẾU ỨNG VIÊN KHÔNG BẰNG CẤP ĐI LÀM (chọn câu này sẽ khóa Câu 4)',
        lockGroup: 'student-status',
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
    name: 'TIÊU CHÍ LỌC HỒ SƠ KHÔNG CÓ KINH NGHIỆM',
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
        text: 'Khi trường tổ chức cuộc thi sáng tạo, bạn copy bài em nộp trước, thầy/cô mặc định em là người copy và em bị mất điểm oan. Em sẽ làm gì?',
        options: [
          { label: 'Trả lời tiêu cực, phê phán thầy/cô, người copy', loai: true },
          { label: 'Trả lời nửa vời, không tích cực, không tiêu cực', score: 1 },
          { label: 'Trả lời theo hướng tích cực, không đổ lỗi', score: 2 },
        ],
      },
      {
        id: 'o3',
        text: 'Em hãy chia sẻ tình huống mà em đã từng khó xử / bất đồng quan điểm với bạn bè / thầy cô và cách giải quyết của em?',
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

export interface RubricScoreResult {
  rubricId: string;
  total: number;
  max: number;
  /** Điểm tối đa trên phần được áp dụng (trừ câu bị khóa chéo). */
  achievableMax: number;
  hasLoai: boolean;
  loaiQuestions: string[];
  passed: boolean;
  verdict: 'PASS' | 'CONSIDER' | 'FAIL' | 'LOAI';
}

/** Điểm tối đa của 1 câu (đáp án điểm cao nhất, multi thì cộng dồn). */
function questionMax(q: RubricQuestion): number {
  const scored = q.options.filter(o => !o.loai).map(o => o.score || 0);
  if (scored.length === 0) return 0;
  return q.multi ? scored.reduce((a, b) => a + b, 0) : Math.max(...scored);
}

/** Chấm điểm server-side từ đáp án HR chọn: answers[qid] = index đáp án (multi: mảng index). */
export function computeRubricScore(
  rubricId: string,
  answers: Record<string, number | number[]>
): RubricScoreResult {
  const rubric = INTERVIEW_RUBRICS.find(r => r.id === rubricId);
  if (!rubric) throw new Error(`Bộ rubric '${rubricId}' không tồn tại (store/office)!`);
  // Nhóm khóa chéo: chỉ câu đầu tiên được trả lời trong nhóm được tính, các câu
  // còn lại bị khóa (VD tick Câu 4 sinh viên thì Câu 5 bị khóa và ngược lại).
  const lockedOut = new Set<string>();
  const groups = new Map<string, RubricQuestion[]>();
  for (const q of rubric.questions) {
    if (!q.lockGroup) continue;
    const arr = groups.get(q.lockGroup) || [];
    arr.push(q);
    groups.set(q.lockGroup, arr);
  }
  const hasAnswers = (qid: string) => {
    const raw = answers?.[qid];
    const picked: number[] = Array.isArray(raw) ? raw : (typeof raw === 'number' ? [raw] : []);
    return picked.some(idx => (rubric.questions.find(q => q.id === qid)?.options || [])[idx]);
  };
  for (const [, qs] of groups) {
    const first = qs.find(q => hasAnswers(q.id));
    for (const q of qs) {
      if (q !== first) lockedOut.add(q.id);
    }
    // Chưa trả lời câu nào trong nhóm: chưa khóa câu nào (UI chặn lưu đến khi chọn 1).
    if (!first) {
      for (const q of qs) lockedOut.delete(q.id);
    }
  }
  let total = 0;
  let hasLoai = false;
  const loaiQuestions: string[] = [];
  let achievableMax = 0;
  for (const q of rubric.questions) {
    if (lockedOut.has(q.id)) continue;
    achievableMax += questionMax(q);
    const raw = answers?.[q.id];
    const picked: number[] = Array.isArray(raw) ? raw : (typeof raw === 'number' ? [raw] : []);
    // Câu single: chỉ tính đáp án đầu tiên hợp lệ.
    const useIdx = q.multi ? picked : picked.slice(0, 1);
    for (const idx of useIdx) {
      const opt = q.options[idx];
      if (!opt) continue;
      if (opt.loai) {
        hasLoai = true;
        if (!loaiQuestions.includes(q.text)) loaiQuestions.push(q.text);
      } else {
        total += opt.score || 0;
      }
    }
  }
  // PASS khi đạt ngưỡng trên phần được áp dụng (VD chỉ trả lời Câu 5 thì tối đa
  // phần áp dụng là 11 — phải tuyệt đối mới pass).
  const need = Math.min(rubric.passScore, achievableMax);
  let verdict: RubricScoreResult['verdict'];
  if (hasLoai) verdict = 'LOAI';
  else if (total >= need) verdict = 'PASS';
  else if (total >= 10) verdict = 'CONSIDER';
  else verdict = 'FAIL';
  return {
    rubricId,
    total,
    max: rubric.maxScore,
    achievableMax,
    hasLoai,
    loaiQuestions,
    passed: verdict === 'PASS',
    verdict,
  };
}

/** Parse chi tiết chấm đã lưu — null khi chưa chấm / dữ liệu hỏng. */
export function parseScoreDetail(raw: unknown): (RubricScoreResult & { answers?: any }) | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw);
    if (typeof o?.total !== 'number') return null;
    return o;
  } catch {
    return null;
  }
}
