/** Bài TEST nâng bậc & đào tạo định kỳ: HR tạo đề + giao đúng nhân viên. */
export interface TestQuestion {
    question_id: string;
    content: string;
    options: string[];
    correct_index: number;
    points?: number;
}
export type TestPaperStatus = 'DRAFT' | 'ASSIGNED' | 'CLOSED';
export interface TestPaper {
    test_id: string;
    title: string;
    description?: string;
    questions: TestQuestion[];
    pass_score?: number;
    time_limit_seconds?: number;
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
    answers?: number[];
    score?: number;
    passed?: boolean;
    submitted_at?: string;
    created_at: string;
    version: number;
}
