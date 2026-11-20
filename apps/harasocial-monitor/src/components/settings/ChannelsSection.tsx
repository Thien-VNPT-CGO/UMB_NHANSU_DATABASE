import { useState } from 'react';
import {
  ChevronDown,
  Copy,
  Layers,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import type { ChannelConfig, ZaloGroupRef } from '../../../shared/types';
import { endpoints, type ZaloGroup } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Badge, Button, CopyField, Field, SectionHeader, Select, TextInput, Toggle, cx } from '../ui';
import type { SectionProps } from './shared';

export function ChannelsSection({ workspace, baseUrl, refresh, toast }: SectionProps) {
  const [groups, setGroups] = useState<ZaloGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [adding, setAdding] = useState(false);

  const loadGroups = async () => {
    setLoadingGroups(true);
    try {
      const result = await endpoints.groups();
      setGroups(result.groups);
      if (result.groups.length === 0) toast('Nick Zalo cá nhân chưa tham gia nhóm nào.', 'info');
      else toast(`Đã tải ${result.groups.length} nhóm Zalo.`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoadingGroups(false);
    }
  };

  const saveChannels = async (channels: ChannelConfig[], message: string) => {
    try {
      await endpoints.updateWorkspace({ channels });
      toast(message, 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const addChannel = () => {
    setAdding(true);
    const channel: ChannelConfig = {
      id: `ch_${Date.now().toString(36)}`,
      name: `Cổng HaraSocial ${workspace.channels.length + 1}`,
      channelKey: `cong-${workspace.channels.length + 1}`,
      zaloGroups: [],
      slaThresholdMinutes: workspace.slaThresholdMinutes,
      notifyOnMissChat: true,
      tagAllOnDutyInShift: false,
      active: true,
      lastSyncAt: null,
      lastSyncStatus: null,
    };
    void saveChannels([...workspace.channels, channel], 'Đã thêm cổng HaraSocial mới.').finally(() => setAdding(false));
  };

  return (
    <div>
      <SectionHeader
        icon={<Layers size={17} />}
        title="Cổng HaraSocial ↔ nhiều nhóm Zalo"
        description="Mỗi cổng có webhook riêng, API kéo 24/7 riêng và danh sách nhóm Zalo riêng. Khi cổng có khách quá hạn, cảnh báo gửi tới tất cả nhóm của cổng đó."
        actions={
          <>
            <Button size="sm" variant="secondary" loading={loadingGroups} onClick={() => void loadGroups()}>
              <RefreshCw size={13} />
              Tải nhóm Zalo
            </Button>
            <Button size="sm" variant="primary" loading={adding} onClick={addChannel}>
              <Plus size={14} />
              Thêm cổng
            </Button>
          </>
        }
      />

      {workspace.channels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-[13px] text-slate-500">
          Chưa có cổng HaraSocial nào. Bấm “Thêm cổng” để bắt đầu.
        </div>
      ) : (
        <div className="space-y-3">
          {workspace.channels.map((channel, index) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              baseUrl={baseUrl}
              ownerUid={workspace.ownerUid}
              groups={groups}
              onSave={(updated) =>
                void saveChannels(
                  workspace.channels.map((item, i) => (i === index ? updated : item)),
                  `Đã lưu cổng “${updated.name}”.`
                )
              }
              onRemove={() => {
                if (!window.confirm(`Xóa cổng “${channel.name}”? Dữ liệu hội thoại của cổng vẫn được giữ trong CSDL.`)) return;
                void saveChannels(
                  workspace.channels.filter((_, i) => i !== index),
                  `Đã xóa cổng “${channel.name}”.`
                );
              }}
              toast={toast}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelCard({
  channel,
  baseUrl,
  ownerUid,
  groups,
  onSave,
  onRemove,
  toast,
}: {
  channel: ChannelConfig;
  baseUrl: string;
  ownerUid: string;
  groups: ZaloGroup[];
  onSave: (channel: ChannelConfig) => void;
  onRemove: () => void;
  toast: SectionProps['toast'];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: channel.name,
    channelKey: channel.channelKey,
    active: channel.active !== false,
    apiUrl: channel.harasocialApiUrl || '',
    apiToken: channel.harasocialAccessToken || '',
    pageId: channel.harasocialPageId || '',
    webhookUrl: channel.zaloWebhookUrl || '',
    sla: channel.slaThresholdMinutes ?? 5,
    notify: channel.notifyOnMissChat !== false,
    tagAll: channel.tagAllOnDutyInShift === true,
  });
  const [zaloGroups, setZaloGroups] = useState<ZaloGroupRef[]>(channel.zaloGroups || []);
  const [pickGroup, setPickGroup] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${baseUrl}/api/webhooks/harasocial?workspace=${encodeURIComponent(ownerUid)}&channelKey=${encodeURIComponent(draft.channelKey)}`;
  const available = groups.filter((g) => !zaloGroups.some((item) => item.id === g.id));

  const save = async () => {
    setSaving(true);
    try {
      onSave({
        ...channel,
        name: draft.name.trim() || channel.name,
        channelKey: draft.channelKey.trim() || channel.channelKey,
        active: draft.active,
        harasocialApiUrl: draft.apiUrl.trim(),
        harasocialAccessToken: draft.apiToken.trim(),
        harasocialPageId: draft.pageId.trim(),
        zaloWebhookUrl: draft.webhookUrl.trim(),
        slaThresholdMinutes: Number(draft.sla),
        notifyOnMissChat: draft.notify,
        tagAllOnDutyInShift: draft.tagAll,
        zaloGroups,
      });
    } finally {
      setSaving(false);
    }
  };

  const testGroup = async (groupId: string) => {
    setTestingId(groupId);
    try {
      const result = await endpoints.testChannel(channel.id, groupId);
      toast(result.success ? `Đã gửi test tới “${result.groupName}”: ${result.detail}` : `Gửi test thất bại: ${result.detail}`, result.success ? 'success' : 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setTestingId(null);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const addGroup = (id: string, name: string) => {
    const cleanId = id.trim();
    if (!cleanId) return;
    if (zaloGroups.some((g) => g.id === cleanId)) {
      toast('Nhóm này đã được gắn vào cổng.', 'info');
      return;
    }
    setZaloGroups([...zaloGroups, { id: cleanId, name: name.trim() || cleanId }]);
  };

  return (
    <div className={cx('rounded-xl border bg-white', open ? 'border-brand-200 shadow-sm' : 'border-slate-200')}>
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-3 sm:px-4">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronDown size={15} className={cx('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-slate-800">{channel.name}</p>
            <p className="truncate text-[11px] text-slate-400">
              /{channel.channelKey} · {zaloGroups.length} nhóm Zalo · SLA {draft.sla}′
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1.5">
          <Badge tone={draft.active ? 'green' : 'slate'} dot>
            {draft.active ? 'Đang bật' : 'Tạm tắt'}
          </Badge>
          {channel.lastSyncStatus ? (
            <Badge tone={channel.lastSyncStatus.startsWith('Lỗi') ? 'red' : 'blue'}>{channel.lastSyncStatus.startsWith('Lỗi') ? 'Lỗi đồng bộ' : 'Đã đồng bộ'}</Badge>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onRemove} title="Xóa cổng">
            <Trash2 size={14} className="text-slate-400" />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="space-y-4 border-t border-slate-100 px-3.5 py-4 sm:px-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tên cổng">
              <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Channel key" hint="Dùng trong URL webhook, không dấu, không khoảng trắng.">
              <TextInput value={draft.channelKey} onChange={(e) => setDraft({ ...draft, channelKey: e.target.value })} />
            </Field>
            <Field label="Ngưỡng SLA riêng (phút)" hint="Để trống dùng mức chung của tài khoản.">
              <TextInput
                type="number"
                min={0}
                max={10080}
                value={draft.sla}
                onChange={(e) => setDraft({ ...draft, sla: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
                <Webhook size={14} className="text-slate-400" />
                Webhook HaraSocial của cổng
              </p>
              <Button size="sm" variant="secondary" onClick={() => void copyWebhook()}>
                <Copy size={13} />
                {copied ? 'Đã chép' : 'Chép URL'}
              </Button>
            </div>
            <p className="mt-2 break-all rounded-md bg-white px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-200">
              {webhookUrl}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              Gửi kèm header <code className="font-mono">x-harasocial-secret</code>. Hỗ trợ GET/POST/OPTIONS cho HaraSocial, Make.com, n8n.
            </p>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-slate-700">Nhóm Zalo nhận cảnh báo ({zaloGroups.length})</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Select value={pickGroup} onChange={(e) => setPickGroup(e.target.value)} className="!w-auto !py-1.5 !text-xs">
                  <option value="">Chọn nhóm đã tải…</option>
                  {available.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.id})
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!pickGroup}
                  onClick={() => {
                    const group = groups.find((g) => g.id === pickGroup);
                    if (group) addGroup(group.id, group.name);
                    setPickGroup('');
                  }}
                >
                  <Plus size={13} />
                  Thêm
                </Button>
              </div>
            </div>

            {zaloGroups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3 text-[11px] text-slate-400">
                Chưa gắn nhóm nào — cảnh báo của cổng sẽ chỉ ghi vào nhật ký, không gửi Zalo.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {zaloGroups.map((group) => (
                  <li key={group.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-slate-700">{group.name}</p>
                      <p className="truncate font-mono text-[10px] text-slate-400">{group.id}</p>
                    </div>
                    <Button size="sm" variant="ghost" loading={testingId === group.id} onClick={() => void testGroup(group.id)}>
                      <Send size={13} />
                      Test gửi
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setZaloGroups(zaloGroups.filter((g) => g.id !== group.id))}
                      title="Bỏ nhóm khỏi cổng"
                    >
                      <Trash2 size={13} className="text-slate-400" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <TextInput value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="Group ID thủ công" />
              <TextInput value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Tên nhóm" />
              <Button
                size="sm"
                variant="secondary"
                disabled={!manualId.trim()}
                onClick={() => {
                  addGroup(manualId, manualName);
                  setManualId('');
                  setManualName('');
                }}
              >
                <Plus size={13} />
                Thêm dòng
              </Button>
            </div>
          </div>

          <details className="rounded-lg border border-slate-200">
            <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-slate-700">API kéo hội thoại 24/7 (tùy chọn)</summary>
            <div className="space-y-3 border-t border-slate-100 px-3 py-3">
              <Field label="HaraSocial API URL (HTTPS)" hint="Chỉ nhận HTTPS công khai; hệ thống chặn SSRF (localhost, IP nội bộ, metadata).">
                <TextInput value={draft.apiUrl} onChange={(e) => setDraft({ ...draft, apiUrl: e.target.value })} placeholder="https://api.harasocial.vn/..." />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Access Token">
                  <TextInput type="password" value={draft.apiToken} onChange={(e) => setDraft({ ...draft, apiToken: e.target.value })} />
                </Field>
                <Field label="Page ID (tùy chọn)" hint="Dùng để nhận diện tin do page gửi.">
                  <TextInput value={draft.pageId} onChange={(e) => setDraft({ ...draft, pageId: e.target.value })} />
                </Field>
              </div>
              {channel.lastSyncAt ? (
                <p className="text-[11px] text-slate-400">Đồng bộ gần nhất: {formatDateTime(channel.lastSyncAt)}</p>
              ) : null}
            </div>
          </details>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1">
            <Toggle label="Cổng đang hoạt động" description="Tắt để tạm dừng nhận dữ liệu và cảnh báo của cổng." checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} />
            <div className="h-px bg-slate-200" />
            <Toggle label="Cảnh báo khi quá hạn" checked={draft.notify} onChange={(v) => setDraft({ ...draft, notify: v })} />
            <div className="h-px bg-slate-200" />
            <Toggle label="Tag toàn bộ người đang trực" checked={draft.tagAll} onChange={(v) => setDraft({ ...draft, tagAll: v })} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Field label="Webhook Zalo riêng của cổng (ghi đè webhook chung)" className="min-w-[240px] flex-1">
              <TextInput value={draft.webhookUrl} onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value })} placeholder="https://hook... (để trống dùng webhook chung)" />
            </Field>
            <Button variant="primary" loading={saving} onClick={() => void save()} className="mt-5">
              Lưu cổng
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
