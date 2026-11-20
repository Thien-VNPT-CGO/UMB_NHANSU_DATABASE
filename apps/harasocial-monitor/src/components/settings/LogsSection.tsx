import { useMemo, useState } from 'react';
import { BellRing, Search } from 'lucide-react';
import type { NotificationLog, WorkspaceConfig } from '../../../shared/types';
import { formatDateTime, truncate } from '../../lib/format';
import { Badge, EmptyState, SectionHeader } from '../ui';

export function LogsSection({ workspace, logs }: { workspace: WorkspaceConfig; logs: NotificationLog[] }) {
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [search, setSearch] = useState('');

  const channelName = (id: string | null) => (id ? workspace.channels.find((c) => c.id === id)?.name || id : '—');

  const rows = useMemo(() => {
    const text = search.trim().toLowerCase();
    return logs
      .filter((l) => (filter === 'all' ? true : filter === 'success' ? l.success : !l.success))
      .filter((l) =>
        !text
          ? true
          : `${l.zaloGroupName} ${l.detail} ${channelName(l.channelId)}`.toLowerCase().includes(text)
      )
      .slice(0, 200);
  }, [logs, filter, search, workspace.channels]);

  return (
    <div>
      <SectionHeader
        icon={<BellRing size={17} />}
        title="Lịch sử cảnh báo đã gửi tới nhóm Zalo"
        description="Ghi nhận mọi lần gửi thật (live_api) và cả trường hợp chỉ ghi nhật ký do cổng chưa gắn nhóm (sandbox_log)."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
              {(
                [
                  ['all', 'Tất cả'],
                  ['success', 'Thành công'],
                  ['failed', 'Thất bại'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={
                    filter === value
                      ? 'rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 shadow-sm'
                      : 'rounded-md px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-700'
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm nhóm, nội dung…"
                className="w-40 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="Chưa có cảnh báo nào" description="Khi hội thoại vượt ngưỡng SLA hoặc bạn bấm “Nhắc Zalo ngay”, kết quả gửi sẽ xuất hiện tại đây." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5 font-medium">Thời điểm</th>
                <th className="px-3 py-2.5 font-medium">Nhóm Zalo</th>
                <th className="px-3 py-2.5 font-medium">Cổng</th>
                <th className="px-3 py-2.5 font-medium">Phương thức</th>
                <th className="px-3 py-2.5 font-medium">Lần</th>
                <th className="px-3 py-2.5 font-medium">Kết quả</th>
                <th className="px-3 py-2.5 font-medium">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((log) => (
                <tr key={log.id} className="align-top hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] tabular-nums text-slate-500">{formatDateTime(log.createdAt)}</td>
                  <td className="px-3 py-2">
                    <p className="text-[12px] font-medium text-slate-700">{log.zaloGroupName || '—'}</p>
                    <p className="font-mono text-[10px] text-slate-400">{log.zaloGroupId || '—'}</p>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-slate-600">{channelName(log.channelId)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={log.mode === 'live_api' ? 'blue' : 'slate'}>{log.mode === 'live_api' ? 'Gửi thật' : 'Chỉ ghi log'}</Badge>
                    <p className="mt-0.5 text-[10px] text-slate-400">{log.provider}</p>
                  </td>
                  <td className="px-3 py-2 text-center text-[12px] tabular-nums text-slate-600">{log.alertCount || '—'}</td>
                  <td className="px-3 py-2">
                    <Badge tone={log.success ? 'green' : 'red'} dot>
                      {log.success ? 'Thành công' : 'Thất bại'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <p className="max-w-[300px] text-[11px] leading-relaxed text-slate-500">{truncate(log.detail, 200) || '—'}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
