import type { WorkspaceConfig } from '../../../shared/types';

export type ToastTone = 'success' | 'error' | 'info';

export interface SectionProps {
  workspace: WorkspaceConfig;
  baseUrl: string;
  refresh: () => Promise<void>;
  toast: (message: string, tone?: ToastTone) => void;
}

export const MODE_LABEL: Record<string, string> = {
  personal: 'Zalo cá nhân (QR / Cookie)',
  webhook: 'Webhook trung gian (Make / n8n)',
  oa_group: 'Zalo OA — Nhóm (GMF v3.0)',
  oa_user: 'Zalo OA — Tin nhắn 1-1',
};
