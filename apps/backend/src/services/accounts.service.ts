import { v4 as uuidv4 } from 'uuid';
import {
  AccountStatus,
  EmployeeAccount,
  NotificationInboxItem,
  NotificationOutboxItem,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { Server } from 'socket.io';

export class AccountsService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  async activateAccount(
    accountId: string,
    adminId: string,
    expectedVersion = 1,
    idempotencyKey?: string
  ): Promise<{ operationId: string; result: EmployeeAccount }> {
    return singleWriterQueue.enqueue({
      idempotencyKey: idempotencyKey || `ACTIVATE_${accountId}_${expectedVersion}`,
      entityType: 'TAI_KHOAN_NHAN_VIEN',
      entityId: accountId,
      expectedVersion,
      actorId: adminId,
      execute: async () => {
        // 1. Update Sheets
        const updated = await this.repo.updateAccountStatus(accountId, 'ACTIVE', adminId, expectedVersion);

        // 2. Write Outbox and Inbox notification
        const notifId = uuidv4();
        const eventId = uuidv4();
        const outbox: Omit<NotificationOutboxItem, 'created_at'> = {
          notification_id: notifId,
          event_id: eventId,
          recipient_id: updated.employee_id,
          dedupe_key: `ACCOUNT_ACTIVATED_${accountId}`,
          type: 'account.activated',
          severity: 'SUCCESS',
          title: 'Tài khoản đã được kích hoạt',
          summary: 'Admin đã kích hoạt tài khoản của bạn. Bạn có thể sử dụng đầy đủ chức năng.',
          target_path: '/home',
          channel: 'IN_APP',
          delivery_status: 'QUEUED',
          attempts: 1,
        };

        const inboxes: Omit<NotificationInboxItem, 'created_at' | 'version'>[] = [
          {
            inbox_id: uuidv4(),
            notification_id: notifId,
            recipient_id: updated.employee_id,
            title: outbox.title,
            summary: outbox.summary,
            severity: outbox.severity,
            target_path: outbox.target_path,
          },
        ];

        await this.repo.createNotification(outbox, inboxes);

        // 3. Emit Socket event after confirmation
        if (this.io) {
          this.io.to(`user:${updated.employee_id}`).emit('account.activated', {
            event_id: eventId,
            accountId: updated.account_id,
            employeeId: updated.employee_id,
            status: 'ACTIVE',
            version: updated.version,
          });
        }

        // 4. Audit
        await this.repo.recordAuditLog({
          log_id: `LOG_${Date.now()}`,
          actor_id: adminId,
          actor_role: 'ADMIN',
          action: 'ACTIVATE_ACCOUNT',
          target_entity: 'TAI_KHOAN_NHAN_VIEN',
          target_id: accountId,
          details: `Activated account ${accountId} for employee ${updated.employee_id}`,
        });

        return updated;
      },
    });
  }

  async revokeAccount(
    accountId: string,
    adminId: string,
    expectedVersion: number,
    status: AccountStatus = 'REVOKED',
    idempotencyKey?: string
  ): Promise<{ operationId: string; result: EmployeeAccount }> {
    return singleWriterQueue.enqueue({
      idempotencyKey: idempotencyKey || `REVOKE_${accountId}_${expectedVersion}`,
      entityType: 'TAI_KHOAN_NHAN_VIEN',
      entityId: accountId,
      expectedVersion,
      actorId: adminId,
      execute: async () => {
        // 1. Update Sheets
        const updated = await this.repo.updateAccountStatus(accountId, status, adminId, expectedVersion);

        // 2. Force logout via Socket
        if (this.io) {
          this.io.to(`user:${updated.employee_id}`).emit('employee:forceLogout', {
            event_id: uuidv4(),
            employeeId: updated.employee_id,
            status,
            reason: `Tài khoản đã bị chuyển sang trạng thái ${status} bởi quản trị viên.`,
          });
        }

        // 3. Audit
        await this.repo.recordAuditLog({
          log_id: `LOG_${Date.now()}`,
          actor_id: adminId,
          actor_role: 'ADMIN',
          action: `ACCOUNT_${status}`,
          target_entity: 'TAI_KHOAN_NHAN_VIEN',
          target_id: accountId,
          details: `Status changed to ${status} for employee ${updated.employee_id}`,
        });

        return updated;
      },
    });
  }

  async getAccount(id: string): Promise<EmployeeAccount | null> {
    return this.repo.getAccountById(id);
  }
}
