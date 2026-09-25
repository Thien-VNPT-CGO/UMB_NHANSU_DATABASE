import { v4 as uuidv4 } from 'uuid';
import { OperationRecord, OperationState } from '@ubm/shared';
import { ISheetsRepository } from './sheets.interface.js';

export interface QueuedTask<T> {
  operationId: string;
  idempotencyKey?: string;
  entityType: string;
  entityId: string;
  expectedVersion?: number;
  actorId: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

export class SingleWriterQueue {
  private queue: QueuedTask<any>[] = [];
  private isProcessing = false;
  private repository: ISheetsRepository | null = null;

  constructor() {}

  public setRepository(repo: ISheetsRepository) {
    this.repository = repo;
  }

  /** Số job đang chờ trong hàng đợi (đo thật cho dashboard giám sát). */
  public getPendingCount(): number {
    return this.queue.length + (this.isProcessing ? 1 : 0);
  }

  public async enqueue<T>(options: {
    idempotencyKey?: string;
    entityType: string;
    entityId: string;
    expectedVersion?: number;
    actorId: string;
    execute: () => Promise<T>;
  }): Promise<{ operationId: string; result: T }> {
    const operationId = uuidv4();

    // Check idempotency if key provided and repository is available
    if (options.idempotencyKey && this.repository) {
      const existingOp = await this.repository.findOperationByIdempotencyKey(options.idempotencyKey);
      if (existingOp) {
        if (existingOp.operation_state === 'COMPLETED' && existingOp.outcome) {
          try {
            const cachedResult = JSON.parse(existingOp.outcome);
            return { operationId: existingOp.operation_id, result: cachedResult as T };
          } catch (e) {
            // fallback to re-evaluating if json parse fails
          }
        } else if (existingOp.operation_state === 'IN_PROGRESS' || existingOp.operation_state === 'PENDING') {
          throw new Error('OPERATION_IN_PROGRESS');
        } else if (existingOp.operation_state === 'NEEDS_RECONCILIATION') {
          throw new Error('NEEDS_RECONCILIATION');
        }
      }
    }

    return new Promise<{ operationId: string; result: T }>((resolve, reject) => {
      this.queue.push({
        operationId,
        idempotencyKey: options.idempotencyKey,
        entityType: options.entityType,
        entityId: options.entityId,
        expectedVersion: options.expectedVersion,
        actorId: options.actorId,
        execute: options.execute,
        resolve: (val: T) => resolve({ operationId, result: val }),
        reject,
      });

      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const task = this.queue.shift();

    if (!task) {
      this.isProcessing = false;
      return;
    }

    try {
      if (this.repository && task.idempotencyKey) {
        await this.repository.recordOperation({
          operation_id: task.operationId,
          idempotency_key: task.idempotencyKey,
          entity_type: task.entityType,
          entity_id: task.entityId,
          expected_version: task.expectedVersion ?? 1,
          operation_state: 'IN_PROGRESS',
          actor_id: task.actorId,
        });
      }

      const result = await task.execute();

      if (this.repository && task.idempotencyKey) {
        await this.repository.updateOperation(task.operationId, {
          operation_state: 'COMPLETED',
          outcome: JSON.stringify(result),
        });
      }

      task.resolve(result);
    } catch (error: any) {
      if (this.repository && task.idempotencyKey) {
        // If error is partial or sheet failed, mark as NEEDS_RECONCILIATION if multi-step, or FAILED
        const isReconcile = error.message?.includes('RECONCILE') || error.message?.includes('PARTIAL');
        await this.repository.updateOperation(task.operationId, {
          operation_state: isReconcile ? 'NEEDS_RECONCILIATION' : 'FAILED',
          error: error.message || 'UNKNOWN_ERROR',
        });
      }
      task.reject(error);
    } finally {
      this.isProcessing = false;
      this.processQueue();
    }
  }
}

export const singleWriterQueue = new SingleWriterQueue();
