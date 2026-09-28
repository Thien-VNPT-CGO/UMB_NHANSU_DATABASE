/** Bài TEST nâng bậc & đào tạo định kỳ: HR tạo đề + giao đúng nhân viên. */

export interface TestQuestion {
  question_id: string;
  content: string;
  options: string[]; // tối thiểu 2 đáp án
  correct_index: number; // vị trí đáp án đúng trong options
  points?: number; // mặc định 1
}

export type TestPaperStatus = 'DRAFT' | 'ASSIGNED' | 'CLOSED';

export interface TestPaper {
  test_id: string;
  title: string;
  description?: string;
  questions: TestQuestion[];
  pass_score?: number; // thang 10, mặc định 8
  time_limit_seconds?: number; // mặc định 480
  status: TestPaperStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export type TestSubmissionStatus = 'ASSIGNED' | 'SUBMITTED';

export interface TestSubmission {
  submission_id: string;
  test_id: string;
  employee_id: string;
  status: TestSubmissionStatus;
  answers?: number[]; // index đáp án đã chọn theo từng câu
  score?: number; // thang 10
  passed?: boolean;
  submitted_at?: string;
  created_at: string;
  version: number;
}
