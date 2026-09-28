import { v4 as uuidv4 } from 'uuid';
import { TestPaper, TestQuestion } from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { Server } from 'socket.io';

function sanitizeQuestions(input: any[]): TestQuestion[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('TEST_EMPTY_QUESTIONS: Bài test phải có ít nhất 1 câu hỏi.');
  }
  if (input.length > 100) throw new Error('TEST_TOO_MANY_QUESTIONS: Tối đa 100 câu.');
  return input.map((q, i) => {
    const content = String(q?.content || q?.question || '').trim();
    const options = Array.isArray(q?.options) ? q.options.map((o: any) => String(o ?? '').trim()) : [];
    const correct = Number(q?.correct_index ?? q?.correctIndex);
    if (!content) throw new Error(`TEST_BAD_QUESTION: Câu ${i + 1} thiếu nội dung.`);
    if (options.length < 2) throw new Error(`TEST_BAD_QUESTION: Câu ${i + 1} cần ít nhất 2 đáp án.`);
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      throw new Error(`TEST_BAD_QUESTION: Câu ${i + 1} chưa chọn đáp án đúng.`);
    }
    return {
      question_id: String(q?.question_id || `Q_${i + 1}`),
      content,
      options,
      correct_index: correct,
      points: Number(q?.points) > 0 ? Number(q.points) : 1,
    };
  });
}

/** Chấm theo đáp án đúng trong đề (snapshot lúc giao bài). Thang 10, làm tròn 1 lẻ. */
export function gradePaper(paper: TestPaper, answers: number[]): { score: number; passed: boolean } {
  const totalPoints = paper.questions.reduce((s, q) => s + (q.points || 1), 0) || 1;
  let earned = 0;
  paper.questions.forEach((q, i) => {
    if (answers[i] === q.correct_index) earned += q.points || 1;
  });
  const score = Math.round((earned / totalPoints) * 10 * 10) / 10;
  return { score, passed: score >= (paper.pass_score ?? 8) };
}

/** Ẩn đáp án đúng khi trả đề cho nhân viên làm bài. */
export function stripAnswers(paper: TestPaper): Omit<TestPaper, 'questions'> & { questions: Omit<TestQuestion, 'correct_index'>[] } {
  return {
    ...paper,
    questions: paper.questions.map(({ correct_index: _omit, ...q }) => q),
  };
}

export class TestsService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  /** HR tạo đề + giao cho đúng danh sách nhân viên (mỗi người 1 bài làm riêng). */
  async createPaper(data: {
    title: string;
    description?: string;
    questions: any[];
    passScore?: number;
    timeLimitSeconds?: number;
    employeeIds: string[];
    actorId: string;
  }) {
    const title = String(data.title || '').trim();
    if (!title) throw new Error('TEST_MISSING_TITLE: Thiếu tiêu đề bài test.');
    const questions = sanitizeQuestions(data.questions);
    const employeeIds = [...new Set((data.employeeIds || []).map(String).filter(Boolean))];
    if (employeeIds.length === 0) throw new Error('TEST_NO_ASSIGNEE: Chưa chọn nhân viên nào để giao bài.');
    if (employeeIds.length > 200) throw new Error('TEST_TOO_MANY_ASSIGNEES: Tối đa 200 nhân viên/lần giao.');
    // Chỉ giao cho nhân viên có thật, chưa nghỉ việc.
    for (const empId of employeeIds) {
      const emp = await this.repo.getEmployeeById(empId).catch(() => null);
      if (!emp) throw new Error(`EMPLOYEE_NOT_FOUND: Không tìm thấy nhân viên ${empId}.`);
      if ((emp as any).employment_status === 'TERMINATED') {
        throw new Error(`EMPLOYMENT_NOT_ELIGIBLE: ${empId} đã nghỉ việc, không thể giao bài.`);
      }
    }
    const testId = `TEST_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const nowIso = new Date().toISOString();
    return singleWriterQueue.enqueue({
      entityType: 'BAI_THI',
      entityId: testId,
      actorId: data.actorId,
      execute: async () => {
        const paper = await this.repo.createTestPaper({
          test_id: testId,
          title,
          description: String(data.description || ''),
          questions,
          pass_score: Number(data.passScore) >= 0 && Number(data.passScore) <= 10 ? Number(data.passScore) : 8,
          time_limit_seconds: Number(data.timeLimitSeconds) > 0 ? Math.min(Number(data.timeLimitSeconds), 7200) : 480,
          status: 'ASSIGNED',
          created_by: data.actorId,
        });
        const submissions = [];
        for (const empId of employeeIds) {
          submissions.push(
            await this.repo.createTestSubmission({
              submission_id: `TSUB_${uuidv4().slice(0, 8)}`,
              test_id: testId,
              employee_id: empId,
              status: 'ASSIGNED',
            })
          );
        }
        if (this.io) {
          for (const empId of employeeIds) {
            this.io.to(`user:${empId}`).emit('test.assigned', { testId, title, submittedAt: nowIso });
          }
        }
        return { paper, submissions, assignedCount: submissions.length };
      },
    });
  }

  async listPapers() {
    return this.repo.listTestPapers();
  }

  async listSubmissions(testId?: string, employeeId?: string) {
    return this.repo.listTestSubmissions(testId, employeeId);
  }

  /** Bài của chính nhân viên (chỉ bài được giao cho mình mới thấy). Kèm đề đã ẩn đáp án. */
  async myTests(employeeId: string) {
    const subs = await this.repo.listTestSubmissions(undefined, employeeId);
    const out = [];
    for (const s of subs) {
      const paper = await this.repo.getTestPaper(s.test_id).catch(() => null);
      if (!paper) continue;
      out.push({ submission: s, paper: stripAnswers(paper) });
    }
    return out.sort((a, b) => String(b.submission.created_at).localeCompare(String(a.submission.created_at)));
  }

  /** Nhân viên nộp bài: verify đúng người, chấm tự động theo đề. */
  async submitAnswers(submissionId: string, employeeId: string, answers: number[]) {
    const subs = await this.repo.listTestSubmissions();
    const sub = subs.find(s => s.submission_id === submissionId);
    if (!sub) throw new Error('SUBMISSION_NOT_FOUND');
    if (sub.employee_id !== employeeId) throw new Error('TEST_FORBIDDEN: Bài này không giao cho bạn.');
    if (sub.status === 'SUBMITTED') throw new Error('TEST_ALREADY_SUBMITTED: Bài đã nộp, không nộp lại.');
    const paper = await this.repo.getTestPaper(sub.test_id);
    if (!paper) throw new Error('TEST_NOT_FOUND');
    if (!Array.isArray(answers) || answers.length !== paper.questions.length) {
      throw new Error('TEST_BAD_ANSWERS: Số đáp án không khớp số câu hỏi.');
    }
    const { score, passed } = gradePaper(paper, answers.map(Number));
    return singleWriterQueue.enqueue({
      entityType: 'BAI_LAM',
      entityId: submissionId,
      actorId: employeeId,
      execute: async () => {
        const updated = await this.repo.updateTestSubmission(submissionId, {
          status: 'SUBMITTED',
          answers: answers.map(Number),
          score,
          passed,
          submitted_at: new Date().toISOString(),
        });
        if (this.io) {
          this.io.to(`user:${employeeId}`).emit('test.graded', { submissionId, testId: sub.test_id, score, passed });
        }
        return updated;
      },
    });
  }
}
