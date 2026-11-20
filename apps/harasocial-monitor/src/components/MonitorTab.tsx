import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCheck,
  Clock,
  Filter,
  Inbox,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Signal,
} from 'lucide-react';
import type { HarasocialConversation, NotificationLog, SalesStaff, WorkspaceConfig } from '../../shared/types';
import { selectDutyStaff } from '../../shared/staff';
import { vnDayKey } from '../../shared/time';
import { formatElapsed, formatMinutes, formatTime, relativeFrom, truncate } from '../lib/format';
import { Badge, Button, Card, EmptyState, Select, cx } from './ui';

export interface MonitorTabProps {
  workspace: WorkspaceConfig;
  staff: SalesStaff[];
  conversations: HarasocialConversation[];
  logs: NotificationLog[];
  now: number;
  streaming: boolean;
  busy: { sync?: boolean; scan?: boolean; replyId?: string; alertId?: string };
  onSync: () => void;
  onScan: () => void;
  onReply: (id: string) => void;
  onAlert: (id: string) => void;
  onChangeSla: (minutes: number) => void;
}

const SLA_OPTIONS = [1, 2, 3, 5, 10, 15, 30, 60];

function statusTone(status: HarasocialConversation['status']): { tone: 'green' | 'amber' | 'red'; label: string } {
  if (status === 'replied') return { tone: 'green', label: 'Đã phản hồi' };
  if (status === 'missed') return { tone: 'red', label: 'Quá hạn SLA' };
  return { tone: 'amber', label: 'Đang chờ' };
}

export function MonitorTab(props: MonitorTabProps) {
  const { workspace, staff, conversations, logs, now, busy, streaming } = props;
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'missed' | 'replied'>('all');
  const [keyword, setKeyword] = useState('');
  const [showFilter, setShowFilter] = useState(false);

  const channelMap = useMemo(() => new Map(workspace.channels.map((c) => [c.id, c])), [workspace.channels]);

  const kpi = useMemo(() => {
    const waiting = conversations.filter((c) => c.lastSender === 'customer' && c.status !== 'replied');
    const missed = waiting.filter((c) => c.status === 'missed');
    const replied = conversations.filter((c) => c.status === 'replied');
    const today = vnDayKey(new Date(now));
    const alerts = logs.filter((l) => l.success && vnDayKey(l.createdAt) === today);
    return { waiting: waiting.length, missed: missed.length, replied: replied.length, alerts: alerts.length };
  }, [conversations, logs, now]);

  const rows = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    return conversations
      .filter((c) => (channelFilter === 'all' ? true : c.channelId === channelFilter))
      .filter((c) => (statusFilter === 'all' ? true : c.status === statusFilter))
      .filter((c) =>
        !text
          ? true
          : `${c.customerName} ${c.lastMessage} ${channelMap.get(c.channelId)?.name || ''}`.toLowerCase().includes(text)
      )
      .sort((a, b) => {
        const rank = (c: HarasocialConversation) => (c.status === 'missed' ? 0 : c.status === 'waiting' ? 1 : 2);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return Date.parse(b.lastCustomerMessageAt || '') - Date.parse(a.lastCustomerMessageAt || '') || 0;
      });
  }, [conversations, channelFilter, statusFilter, keyword, channelMap]);

  const activeChannels = workspace.channels.filter((c) => c.active !== false).length;

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<MessageSquare size={16} />}
          label="Chờ xử lý"
          value={kpi.waiting}
          hint="Khách đang chờ phản hồi"
          tone="amber"
        />
        <KpiCard
          icon={<AlertTriangle size={16} />}
          label="Đã quá hạn SLA"
          value={kpi.missed}
          hint={`Ngưỡng hiện tại ${workspace.slaThresholdMinutes} phút`}
          tone="red"
        />
        <KpiCard
          icon={<CheckCheck size={16} />}
          label="Đã phản hồi"
          value={kpi.replied}
          hint="Hội thoại đã được trả lời"
          tone="green"
        />
        <KpiCard
          icon={<BellRing size={16} />}
          label="Cảnh báo Zalo hôm nay"
          value={kpi.alerts}
          hint="Số lần gửi thành công"
          tone="blue"
        />
      </div>

      {/* Điều khiển */}
      <Card className="!p-3 sm:!p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
            <Clock size={14} className="text-slate-400" />
            <span className="text-xs text-slate-500">SLA</span>
            <select
              value={workspace.slaThresholdMinutes}
              onChange={(e) => props.onChangeSla(Number(e.target.value))}
              className="cursor-pointer rounded-md border-0 bg-transparent py-0.5 pl-1 pr-6 text-xs font-semibold text-slate-800 focus:outline-none"
              aria-label="Ngưỡng SLA toàn hệ thống"
            >
              {[...new Set([...SLA_OPTIONS, workspace.slaThresholdMinutes])].sort((a, b) => a - b).map((value) => (
                <option key={value} value={value}>
                  {value} phút
                </option>
              ))}
            </select>
          </div>

          <div className="hidden sm:block">
            <Select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="!w-auto !py-1.5 !text-xs"
              aria-label="Lọc theo cổng HaraSocial"
            >
              <option value="all">Tất cả cổng ({activeChannels} đang bật)</option>
              {workspace.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </Select>
          </div>

          <Button size="sm" variant="secondary" onClick={() => setShowFilter((v) => !v)} className="sm:hidden">
            <Filter size={14} />
            Lọc
          </Button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] text-slate-400 sm:flex">
              <Signal size={13} className={streaming ? 'text-emerald-500' : 'text-slate-300'} />
              {streaming ? 'Realtime đang kết nối' : 'Đang kết nối lại…'}
            </span>
            <Button size="sm" variant="secondary" loading={busy.sync} onClick={props.onSync}>
              <RefreshCw size={14} />
              Đồng bộ HaraSocial ngay
            </Button>
            <Button size="sm" variant="primary" loading={busy.scan} onClick={props.onScan}>
              <Inbox size={14} />
              Chạy quét SLA ngay
            </Button>
          </div>
        </div>

        {showFilter ? (
          <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:hidden">
            <Select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label="Lọc theo cổng">
              <option value="all">Tất cả cổng</option>
              {workspace.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
            {(
              [
                ['all', 'Tất cả'],
                ['waiting', 'Đang chờ'],
                ['missed', 'Quá hạn'],
                ['replied', 'Đã trả lời'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={cx(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  statusFilter === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Tìm khách hàng, tin nhắn, cổng…"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <span className="ml-auto text-[11px] tabular-nums text-slate-400">
            Quét gần nhất: {workspace.lastWorkerRunAt ? relativeFrom(workspace.lastWorkerRunAt, now) : '—'}
          </span>
        </div>
      </Card>

      {/* Bảng hội thoại */}
      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={conversations.length === 0 ? 'Chưa có hội thoại thật nào' : 'Không có hội thoại khớp bộ lọc'}
              description={
                conversations.length === 0
                  ? 'Gắn Webhook HaraSocial hoặc cấu hình API kéo 24/7 trong tab Cài đặt. Dữ liệu chỉ hiển thị từ nguồn thật — không có bản ghi giả lập.'
                  : 'Thử đổi cổng, trạng thái hoặc từ khóa tìm kiếm.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Khách hàng &amp; kênh</th>
                  <th className="px-3 py-2.5 font-medium">Cổng HaraSocial</th>
                  <th className="px-3 py-2.5 font-medium">Tin nhắn cuối</th>
                  <th className="px-3 py-2.5 font-medium">Nhân viên trực</th>
                  <th className="px-3 py-2.5 text-right font-medium">Chờ / đã tag</th>
                  <th className="px-4 py-2.5 text-right font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((conversation) => {
                  const channel = channelMap.get(conversation.channelId);
                  const status = statusTone(conversation.status);
                  const open = conversation.lastSender === 'customer' && conversation.status !== 'replied';
                  const waitedMs = open && conversation.lastCustomerMessageAt
                    ? now - Date.parse(conversation.lastCustomerMessageAt)
                    : null;
                  const selection = channel
                    ? selectDutyStaff(staff, channel.id, now, {
                        assignedStaffId: conversation.assignedStaffId,
                        tagAllOnDutyInShift: channel.tagAllOnDutyInShift ?? workspace.zalo.tagAllOnDutyInShift ?? false,
                      })
                    : null;
                  const threshold = channel?.slaThresholdMinutes ?? workspace.slaThresholdMinutes;
                  const overdue = waitedMs !== null && waitedMs >= threshold * 60_000;

                  return (
                    <tr key={conversation.id} className="align-top transition-colors hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                            {conversation.customerName.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-slate-800">{conversation.customerName}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge tone="slate">{conversation.channel}</Badge>
                              <Badge tone={status.tone}>{status.label}</Badge>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-[13px] text-slate-700">{channel?.name || '—'}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {channel ? `${(channel.zaloGroups || []).length} nhóm Zalo · SLA ${threshold}′` : 'Cổng đã bị xóa'}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="max-w-[260px] text-[13px] leading-snug text-slate-700">{truncate(conversation.lastMessage, 110) || '—'}</p>
                        <p className="mt-1 text-[11px] tabular-nums text-slate-400">
                          {conversation.lastSender === 'staff' ? 'Nhân viên' : 'Khách'} ·{' '}
                          {formatTime(conversation.lastCustomerMessageAt || undefined)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        {selection && selection.targets.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {selection.targets.map((target) => (
                              <Badge key={target.id} tone="violet">
                                {target.name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[12px] text-slate-400">Không có ai trong ca</span>
                        )}
                        {selection?.mode === 'redirect' ? (
                          <p className="mt-1 text-[10px] text-amber-600">Đã điều hướng do người được gán hết ca</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <p className={cx('text-[13px] font-semibold tabular-nums', overdue ? 'text-rose-600' : 'text-slate-700')}>
                          {open ? formatElapsed(waitedMs) : conversation.responseMinutes !== null ? `${formatMinutes(conversation.responseMinutes)}` : '—'}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {conversation.alertCount > 0 ? `Đã tag ${conversation.alertCount} lần` : 'Chưa tag'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={conversation.status === 'replied'}
                            loading={busy.replyId === conversation.id}
                            onClick={() => props.onReply(conversation.id)}
                            title="Đánh dấu hội thoại đã được nhân viên trả lời"
                          >
                            <CheckCheck size={13} />
                            Đã trả lời
                          </Button>
                          <Button
                            size="sm"
                            variant={overdue ? 'primary' : 'secondary'}
                            disabled={conversation.status === 'replied'}
                            loading={busy.alertId === conversation.id}
                            onClick={() => props.onAlert(conversation.id)}
                            title="Gửi cảnh báo Zalo ngay cho cổng này"
                          >
                            <Send size={13} />
                            Nhắc Zalo ngay
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="px-1 text-[11px] leading-relaxed text-slate-400">
        Cảnh báo lần 1 gửi khi chờ đủ {workspace.slaThresholdMinutes} phút; sau đó nhắc lại mỗi{' '}
        {workspace.repeatAlertIntervalMinutes > 0 ? `${workspace.repeatAlertIntervalMinutes} phút` : '(đã tắt)'} cho tới khi hội thoại được
        đánh dấu đã trả lời. Mỗi cổng gửi tới toàn bộ nhóm Zalo đã gắn của cổng đó.
      </p>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
  tone: 'amber' | 'red' | 'green' | 'blue';
}) {
  const tones = {
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-rose-50 text-rose-600',
    green: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-sky-50 text-sky-600',
  } as const;
  return (
    <Card className="!p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums leading-none text-slate-900">{value}</p>
        </div>
        <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg', tones[tone])}>{icon}</span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-400">{hint}</p>
    </Card>
  );
}
