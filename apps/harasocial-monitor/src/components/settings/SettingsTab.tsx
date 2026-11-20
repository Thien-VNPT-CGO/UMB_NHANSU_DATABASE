import { useState } from 'react';
import { BellRing, Layers, ShieldCheck, Users, SlidersHorizontal, Smartphone } from 'lucide-react';
import type { NotificationLog, SalesStaff } from '../../../shared/types';
import { Card } from '../ui';
import type { SectionProps } from './shared';
import { ZaloAccountSection } from './ZaloAccountSection';
import { SecuritySection } from './SecuritySection';
import { ChannelsSection } from './ChannelsSection';
import { HrSection } from './HrSection';
import { StaffSection } from './StaffSection';
import { LogsSection } from './LogsSection';

type SectionKey = 'zalo' | 'security' | 'channels' | 'hr' | 'staff' | 'logs';

const NAV: Array<{ key: SectionKey; label: string; icon: React.ReactNode }> = [
  { key: 'zalo', label: 'Tài khoản Zalo', icon: <Smartphone size={15} /> },
  { key: 'security', label: 'Bảo mật webhook', icon: <ShieldCheck size={15} /> },
  { key: 'channels', label: 'Cổng & nhóm Zalo', icon: <Layers size={15} /> },
  { key: 'hr', label: 'Tích hợp nhân sự', icon: <Users size={15} /> },
  { key: 'staff', label: 'Nhân viên & ca trực', icon: <Users size={15} /> },
  { key: 'logs', label: 'Lịch sử cảnh báo', icon: <BellRing size={15} /> },
];

export function SettingsTab({
  workspace,
  staff,
  logs,
  baseUrl,
  now,
  refresh,
  toast,
}: SectionProps & { staff: SalesStaff[]; logs: NotificationLog[]; now: number }) {
  const [section, setSection] = useState<SectionKey>('zalo');
  const sectionProps: SectionProps = { workspace, baseUrl, refresh, toast };

  return (
    <div className="grid gap-4 lg:grid-cols-[196px_minmax(0,1fr)]">
      <nav className="lg:sticky lg:top-[68px] lg:self-start">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 lg:flex-col lg:overflow-visible">
          {NAV.map((item) => {
            const active = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={
                  active
                    ? 'flex shrink-0 items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-[12px] font-medium text-brand-700'
                    : 'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }
              >
                <span className={active ? 'text-brand-600' : 'text-slate-400'}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 hidden rounded-xl border border-slate-200 bg-white p-3 lg:block">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
            <SlidersHorizontal size={13} className="text-slate-400" />
            Ngưỡng SLA chung
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{workspace.slaThresholdMinutes} phút</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            Nhắc lại mỗi {workspace.repeatAlertIntervalMinutes > 0 ? `${workspace.repeatAlertIntervalMinutes} phút` : '(tắt)'} · Worker{' '}
            {workspace.cloudWorkerEnabled ? 'bật' : 'tắt'}
          </p>
        </div>
      </nav>

      <Card className="min-w-0 !p-3.5 sm:!p-5">
        {section === 'zalo' ? <ZaloAccountSection {...sectionProps} /> : null}
        {section === 'security' ? <SecuritySection {...sectionProps} /> : null}
        {section === 'channels' ? <ChannelsSection {...sectionProps} /> : null}
        {section === 'hr' ? <HrSection {...sectionProps} /> : null}
        {section === 'staff' ? <StaffSection {...sectionProps} staff={staff} now={now} /> : null}
        {section === 'logs' ? <LogsSection workspace={workspace} logs={logs} /> : null}
      </Card>
    </div>
  );
}
