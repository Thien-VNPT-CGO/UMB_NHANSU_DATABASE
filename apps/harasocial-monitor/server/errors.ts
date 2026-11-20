/** Lỗi nghiệp vụ có HTTP status + mã lỗi để frontend hiển thị. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorPayload(err: unknown) {
  if (err instanceof AppError) {
    return { error: err.message, code: err.code, details: err.details ?? null };
  }
  const message = err instanceof Error ? err.message : 'Lỗi không xác định.';
  return { error: message, code: 'INTERNAL_ERROR', details: null };
}
