import { v4 as uuidv4 } from 'uuid';
import {
  NotificationChannel,
  NotificationInboxItem,
  NotificationOutboxItem,
  NotificationSeverity,
} from '@ubm/shared';
import { ISheetsRepository } from '../repositories/sheets.interface.js';
import { singleWriterQueue } from '../repositories/single-writer-queue.js';
import { Server } from 'socket.io';

export class NotificationsService {
  constructor(
    private repo: ISheetsRepository,
    private io?: Server
  ) {}

  public setSocketServer(io: Server) {
    this.io = io;
  }

  async sendNotification(data: {
    recipientIds: string[];
    type: string;
    severity: NotificationSeverity;
    title: string;
    summary: string;
    targetPath?: string;
    channel?: NotificationChannel;
    actorId?: string;
  }) {
    const notifId = uuidv4();
    const eventId = uuidv4();

    return singleWriterQueue.enqueue({
      entityType: 'NOTIFICATION_OUTBOX',
      entityId: notifId,
      actorId: data.actorId || 'SYSTEM',
      execute: async () => {
        const outbox: Omit<NotificationOutboxItem, 'created_at'> = {
          notification_id: notifId,
          event_id: eventId,
          recipient_id: data.recipientIds.join(','),
          dedupe_key: `NOTIF_${notifId}`,
          type: data.type,
          severity: data.severity,
          title: data.title,
          summary: data.summary,
          target_path: data.targetPath,
          channel: data.channel || 'IN_APP',
          delivery_status: 'QUEUED',
          attempts: 1,
        };

        const inboxes: Omit<NotificationInboxItem, 'created_at' | 'version'>[] = data.recipientIds.map(rid => ({
          inbox_id: uuidv4(),
          notification_id: notifId,
          recipient_id: rid,
          title: data.title,
          summary: data.summary,
          severity: data.severity,
          target_path: data.targetPath,
        }));

        const result = await this.repo.createNotification(outbox, inboxes);

        // Emit Socket event to all recipients
        if (this.io) {
          for (const inbox of result.inboxes) {
            this.io.to(`user:${inbox.recipient_id}`).emit('notification.created', {
              inboxId: inbox.inbox_id,
              eventId,
              title: inbox.title,
              summary: inbox.summary,
              severity: inbox.severity,
              targetPath: inbox.target_path,
              createdAt: inbox.created_at,
            });
          }
        }

        return result;
      },
    });
  }

  async getInbox(recipientId: string, unreadOnly = false) {
    return this.repo.getInboxForRecipient(recipientId, unreadOnly);
  }

  async markRead(inboxId: string, recipientId: string) {
    return this.repo.markNotificationRead(inboxId, recipientId);
  }

  async markAcknowledged(inboxId: string, recipientId: string) {
    return this.repo.markNotificationAcknowledged(inboxId, recipientId);
  }
}
