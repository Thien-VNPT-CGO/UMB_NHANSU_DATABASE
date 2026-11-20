import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Clock,
  Plus,
  Search,
  Trash2,
  UserPlus,
  UserRoundSearch,
  Users,
  X,
} from 'lucide-react';
import type { SalesStaff, WorkspaceConfig } from '../../../shared/types';
import { dutyLabel } from '../../../shared/time';
import { staffCoversChannel } from '../../../shared/staff';
import { endpoints, type ZaloMember } from '../../lib/api';
import { Badge, Button, EmptyState, Field, SectionHeader, Select, TextInput, cx } from '../ui';
import type { SectionProps } from './shared';

export function StaffSection({ workspace, staff, now, refresh, toast }: SectionProps & { staff: SalesStaff[]; now: number }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pickerFor, setPickerFor] = useState<SalesStaff | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase();
    if (!text) return staff;
    return staff.filter((s) => `${s.name} ${s.email || ''} ${s.externalHrId || ''} ${s.zaloUserId}`.toLowerCase().includes(text));
  }, [staff, search]);

  const update = async (s: SalesStaff, patch: Partial<SalesStaff>, message?: string) => {
    setBusyId(s.id);
    try {
      await endpoints.updateStaff(s.id, patch);
      await refresh();
      if (message) toast(message, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (s: SalesStaff) => {
    if (!window.confirm(`Xóa nhân viên “${s.name}” khỏi danh sách giám sát?`)) return;
    try {
      await endpoints.deleteStaff(s.id);
      toast(`Đã xóa ${s.name}.`, 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const channelName = (id: string) => workspace.channels.find((c) => c.id === id)?.name || id;

  return (
    <div>
      <SectionHeader
        icon={<Users size={17} />}
        title="Quản lý nhân viên Sale & ca trực"
        description="Một nhân viên có thể phụ trách nhiều cổng. Mảng cổng rỗng = phụ trách tất cả. Giờ ca tính theo UTC+7, hỗ trợ ca qua đêm."
        actions={
          <>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm nhân viên…"
                className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <Button size="sm" variant="primary" onClick={() => setShowAdd((v) => !v)}>
              <UserPlus size={14} />
              Thêm nhân viên
            </Button>
          </>
        }
      />

      {showAdd ? (
        <AddStaffForm
          workspace={workspace}
          onCancel={() => setShowAdd(false)}
          onCreated={async () => {
            setShowAdd(false);
            toast('Đã thêm nhân viên.', 'success');
            await refresh();
          }}
          toast={toast}
        />
      ) : null}

      {staff.length === 0 ? (
        <EmptyState
          title="Chưa có nhân viên sale"
          description="Thêm nhân viên và gắn Zalo UID thật để hệ thống @tag đúng người khi hội thoại quá hạn."
          action={
            <Button size="sm" variant="primary" onClick={() => setShowAdd(true)}>
              <Plus size={14} />
              Thêm nhân viên đầu tiên
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5 font-medium">Nhân viên</th>
                <th className="px-3 py-2.5 font-medium">Ca trực (GMT+7)</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-3 py-2.5 font-medium">Cổng phụ trách</th>
                <th className="px-3 py-2.5 font-medium">Zalo UID</th>
                <th className="px-3 py-2.5 font-medium">Liên kết HR</th>
                <th className="px-3 py-2.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((person) => (
                <StaffRow
                  key={person.id}
                  person={person}
                  workspace={workspace}
                  now={now}
                  busy={busyId === person.id}
                  expanded={expanded === person.id}
                  onToggle={() => setExpanded(expanded === person.id ? null : person.id)}
                  onUpdate={update}
                  onRemove={() => void remove(person)}
                  onPickUid={() => setPickerFor(person)}
                  channelName={channelName}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pickerFor ? (
        <MemberPicker
          person={pickerFor}
          workspace={workspace}
          onClose={() => setPickerFor(null)}
          onPick={async (uid, name) => {
            await update(pickerFor, { zaloUserId: uid }, `Đã gắn Zalo UID cho ${pickerFor.name}${name ? ` (${name})` : ''}.`);
            setPickerFor(null);
          }}
          toast={toast}
        />
      ) : null}
    </div>
  );
}

function StaffRow({
  person,
  workspace,
  now,
  busy,
  expanded,
  onToggle,
  onUpdate,
  onRemove,
  onPickUid,
  channelName,
}: {
  person: SalesStaff;
  workspace: WorkspaceConfig;
  now: number;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (person: SalesStaff, patch: Partial<SalesStaff>, message?: string) => Promise<void>;
  onRemove: () => void;
  onPickUid: () => void;
  channelName: (id: string) => string;
}) {
  const [shift, setShift] = useState(person.shift);
  const [email, setEmail] = useState(person.email || '');
  const [externalHrId, setExternalHrId] = useState(person.externalHrId || '');
  const [uid, setUid] = useState(person.zaloUserId);

  // Đồng bộ lại giá trị khi HR webhook/SSE cập nhật ca trực realtime.
  useEffect(() => setShift(person.shift), [person.shift]);
  useEffect(() => setEmail(person.email || ''), [person.email]);
  useEffect(() => setExternalHrId(person.externalHrId || ''), [person.externalHrId]);
  useEffect(() => setUid(person.zaloUserId), [person.zaloUserId]);

  const duty = dutyLabel(person.shift, person.active, now);
  const ids = person.monitorChannelIds || [];
  const coversAll = ids.length === 0;

  return (
    <>
      <tr className={cx('align-middle transition-colors hover:bg-slate-50/60', expanded && 'bg-slate-50/60')}>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
              {person.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-slate-800">{person.name}</p>
              <p className="text-[11px] text-slate-400">{person.role || 'sale'}</p>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-slate-300" />
            <input
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              onBlur={() => {
                if (shift.trim() !== person.shift) void onUpdate(person, { shift: shift.trim() });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              placeholder="08:00 - 17:30"
              className="w-[130px] rounded-md border border-transparent bg-transparent px-1.5 py-1 font-mono text-[12px] tabular-nums text-slate-700 hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-col items-start gap-1">
            <Badge tone={duty.onDuty ? 'green' : person.active ? 'slate' : 'amber'} dot>
              {person.active ? duty.label : 'Đã tắt trực'}
            </Badge>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onUpdate(person, { active: !person.active })}
              className="text-[11px] text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline disabled:opacity-50"
            >
              {person.active ? 'Tắt trực' : 'Bật trực'}
            </button>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <button type="button" onClick={onToggle} className="flex max-w-[220px] items-center gap-1 text-left text-[12px] text-slate-600 hover:text-slate-800">
            {coversAll ? (
              <Badge tone="blue">Tất cả cổng</Badge>
            ) : (
              <span className="flex flex-wrap gap-1">
                {ids.slice(0, 2).map((id) => (
                  <Badge key={id} tone="slate">
                    {channelName(id)}
                  </Badge>
                ))}
                {ids.length > 2 ? <Badge tone="slate">+{ids.length - 2}</Badge> : null}
              </span>
            )}
            <ChevronDown size={13} className={cx('shrink-0 text-slate-400 transition-transform', expanded && 'rotate-180')} />
          </button>
        </td>
        <td className="px-3 py-2.5">
          <input
            value={uid}
            onChange={(e) => setUid(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => {
              if (uid.trim() !== person.zaloUserId) void onUpdate(person, { zaloUserId: uid.trim() });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            placeholder="Chưa gắn"
            className="w-[110px] rounded-md border border-transparent bg-transparent px-1.5 py-1 font-mono text-[12px] tabular-nums text-slate-700 hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <button type="button" onClick={onPickUid} className="mt-0.5 flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700">
            <UserRoundSearch size={12} />
            Chọn từ nhóm
          </button>
        </td>
        <td className="px-3 py-2.5">
          <p className="truncate font-mono text-[11px] text-slate-500">{person.externalHrId || '—'}</p>
          <p className="truncate text-[11px] text-slate-400">{person.email || '—'}</p>
        </td>
        <td className="px-3 py-2.5 text-right">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove} title="Xóa nhân viên">
            <Trash2 size={14} className="text-slate-400" />
          </Button>
        </td>
      </tr>

      {expanded ? (
        <tr className="bg-slate-50/60">
          <td colSpan={7} className="px-3 py-3">
            <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">Cổng phụ trách</p>
                <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
                  Không tick cổng nào = phụ trách tất cả cổng (kể cả cổng thêm sau này).
                </p>
                <div className="flex flex-wrap gap-2">
                  {workspace.channels.map((channel) => {
                    const checked = ids.includes(channel.id);
                    return (
                      <label
                        key={channel.id}
                        className={cx(
                          'flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors',
                          checked ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={() => {
                            const next = checked ? ids.filter((id) => id !== channel.id) : [...ids, channel.id];
                            void onUpdate(person, { monitorChannelIds: next });
                          }}
                          className="h-3.5 w-3.5 accent-emerald-600"
                        />
                        {channel.name}
                      </label>
                    );
                  })}
                  {workspace.channels.length === 0 ? <span className="text-[11px] text-slate-400">Chưa có cổng nào.</span> : null}
                </div>
                {!coversAll ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onUpdate(person, { monitorChannelIds: [] })}
                    className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
                  >
                    <X size={12} />
                    Bỏ giới hạn — phụ trách tất cả cổng
                  </button>
                ) : null}
                <p className="mt-3 text-[11px] text-slate-400">
                  {workspace.channels.filter((c) => staffCoversChannel(person, c.id)).length}/{workspace.channels.length} cổng đang áp dụng
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Mã HR (externalHrId)">
                  <TextInput
                    value={externalHrId}
                    onChange={(e) => setExternalHrId(e.target.value)}
                    onBlur={() => {
                      if (externalHrId.trim() !== (person.externalHrId || '')) void onUpdate(person, { externalHrId: externalHrId.trim() });
                    }}
                    placeholder="UBM001"
                  />
                </Field>
                <Field label="Email liên kết">
                  <TextInput
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => {
                      if (email.trim() !== (person.email || '')) void onUpdate(person, { email: email.trim() });
                    }}
                    placeholder="nhanvien@ubm.vn"
                  />
                </Field>
                <Field label="Tên hiển thị khi tag" className="sm:col-span-2">
                  <TextInput
                    defaultValue={person.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value.trim() !== person.name) void onUpdate(person, { name: e.target.value.trim() });
                    }}
                  />
                </Field>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AddStaffForm({
  workspace,
  onCancel,
  onCreated,
  toast,
}: {
  workspace: WorkspaceConfig;
  onCancel: () => void;
  onCreated: () => Promise<void>;
  toast: SectionProps['toast'];
}) {
  const [name, setName] = useState('');
  const [shift, setShift] = useState('08:00 - 17:30');
  const [email, setEmail] = useState('');
  const [externalHrId, setExternalHrId] = useState('');
  const [zaloUserId, setZaloUserId] = useState('');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast('Vui lòng nhập tên nhân viên.', 'error');
      return;
    }
    setSaving(true);
    try {
      await endpoints.createStaff({
        name: name.trim(),
        shift: shift.trim(),
        email: email.trim() || null,
        externalHrId: externalHrId.trim() || null,
        zaloUserId: zaloUserId.trim(),
        monitorChannelIds: channelIds,
        active: true,
      });
      await onCreated();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3.5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tên nhân viên">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" autoFocus />
        </Field>
        <Field label="Ca trực" hint="VD: 08:00 - 17:30 hoặc 22:00 - 06:00">
          <TextInput value={shift} onChange={(e) => setShift(e.target.value)} className="font-mono" />
        </Field>
        <Field label="Zalo UID (tùy chọn)">
          <TextInput value={zaloUserId} onChange={(e) => setZaloUserId(e.target.value.replace(/[^\d]/g, ''))} placeholder=">= 6 chữ số" />
        </Field>
        <Field label="Email liên kết HR">
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nhanvien@ubm.vn" />
        </Field>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr_auto]">
        <Field label="Mã HR">
          <TextInput value={externalHrId} onChange={(e) => setExternalHrId(e.target.value)} placeholder="UBM001" />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">Cổng phụ trách (không tick = tất cả)</span>
          <div className="flex flex-wrap gap-1.5">
            {workspace.channels.map((channel) => {
              const checked = channelIds.includes(channel.id);
              return (
                <label
                  key={channel.id}
                  className={cx(
                    'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
                    checked ? 'border-brand-300 bg-white text-brand-800' : 'border-slate-200 bg-white text-slate-600'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setChannelIds(checked ? channelIds.filter((id) => id !== channel.id) : [...channelIds, channel.id])}
                    className="h-3.5 w-3.5 accent-emerald-600"
                  />
                  {channel.name}
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Lưu nhân viên
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Hủy
          </Button>
        </div>
      </div>
    </div>
  );
}

function MemberPicker({
  person,
  workspace,
  onClose,
  onPick,
  toast,
}: {
  person: SalesStaff;
  workspace: WorkspaceConfig;
  onClose: () => void;
  onPick: (uid: string, name: string) => Promise<void>;
  toast: SectionProps['toast'];
}) {
  const groups = useMemo(() => {
    const map = new Map<string, string>();
    for (const channel of workspace.channels) {
      for (const group of channel.zaloGroups || []) {
        if (!map.has(group.id)) map.set(group.id, group.name);
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [workspace.channels]);

  const [groupId, setGroupId] = useState(groups[0]?.id || '');
  const [members, setMembers] = useState<ZaloMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = async (id: string) => {
    setGroupId(id);
    if (!id) return;
    setLoading(true);
    try {
      const result = await endpoints.members(id);
      setMembers(result.members);
      if (!result.members.length) toast('Không đọc được thành viên nhóm này.', 'info');
    } catch (e) {
      setMembers([]);
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const visible = members.filter((m) => !search.trim() || `${m.name} ${m.uid}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Gắn Zalo UID thật</p>
            <p className="text-[11px] text-slate-400">Chọn thành viên trong nhóm Zalo để gắn cho {person.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 border-b border-slate-100 px-4 py-3">
          <Select value={groupId} onChange={(e) => void load(e.target.value)}>
            <option value="">Chọn nhóm Zalo đã gắn với cổng…</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm thành viên…"
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {groups.length === 0 ? (
            <p className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700">
              Chưa có nhóm Zalo nào được gắn với cổng. Hãy gắn nhóm ở mục “Cổng HaraSocial ↔ nhiều nhóm Zalo” trước.
            </p>
          ) : null}
        </div>

        <div className="min-h-[160px] flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <p className="py-8 text-center text-[12px] text-slate-400">Đang tải thành viên…</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-slate-400">
              {members.length === 0 ? 'Chọn một nhóm để tải thành viên.' : 'Không có thành viên khớp tìm kiếm.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visible.map((member) => (
                <li key={member.uid}>
                  <button
                    type="button"
                    onClick={() => void onPick(member.uid, member.name)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">
                      {member.avatar ? <img src={member.avatar} alt="" className="h-full w-full object-cover" /> : member.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-slate-700">{member.name}</span>
                      <span className="block truncate font-mono text-[10px] text-slate-400">{member.uid}</span>
                    </span>
                    <span className="text-[11px] font-medium text-brand-600">Gắn</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
