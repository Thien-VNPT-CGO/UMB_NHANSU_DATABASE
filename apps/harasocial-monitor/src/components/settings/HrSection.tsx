import { useState } from 'react';
import { Database, Download, KeyRound, RefreshCw, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { endpoints } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Badge, Button, CopyField, Field, SectionHeader, TextArea, TextInput, Toggle } from '../ui';
import type { SectionProps } from './shared';

export function HrSection({ workspace, baseUrl, refresh, toast }: SectionProps) {
  const hr = workspace.hr;
  const [secret, setSecret] = useState(hr.webhookSecret || '');
  const [apiUrl, setApiUrl] = useState(hr.apiUrl || '');
  const [apiToken, setApiToken] = useState(hr.apiToken || '');
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [showSample, setShowSample] = useState(false);

  const webhookUrl = `${baseUrl}/api/webhooks/hr?workspace=${encodeURIComponent(workspace.ownerUid)}`;

  const sampleCode = `// Gọi từ Web App Quản lý Nhân sự ngay sau khi lưu ca
await fetch(${JSON.stringify(webhookUrl)}, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-hr-secret': ${JSON.stringify(secret || '<hr-secret>')}
  },
  body: JSON.stringify({
    employees: [
      {
        staffId: 'UBM001',
        name: 'Nguyễn Văn A',
        email: 'a@ubm.vn',
        shift: '08:00 - 17:30',
        active: true
      }
    ]
  })
});`;

  const patchHr = async (patch: Record<string, unknown>, message: string) => {
    try {
      await endpoints.updateWorkspace({ hr: { ...hr, ...patch } });
      toast(message, 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await endpoints.updateWorkspace({ hr: { ...hr, webhookSecret: secret.trim(), apiUrl: apiUrl.trim(), apiToken: apiToken.trim() } });
      toast('Đã lưu cấu hình tích hợp nhân sự.', 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    setRotating(true);
    try {
      const result = await endpoints.rotateSecret('hr');
      setSecret(result.secret);
      toast('Đã tạo HR secret mới. Hãy cập nhật lại phía Web App Nhân sự.', 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRotating(false);
    }
  };

  const pullNow = async () => {
    setPulling(true);
    try {
      const result = await endpoints.pullHr();
      const summary = result.summary;
      toast(
        summary
          ? `Đã kéo HR: nhận ${summary.received}, khớp ${summary.matched}, tạo ${summary.created}.`
          : 'Đã kéo dữ liệu HR.',
        'success'
      );
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPulling(false);
    }
  };

  return (
    <div>
      <SectionHeader
        icon={<Database size={17} />}
        title="Tích hợp Web App Quản lý Nhân sự (realtime)"
        description="Webhook nhận cả 1 nhân viên hoặc danh sách; tự khớp theo staffId → externalHrId → email → Zalo UID → tên tiếng Việt. Chỉ cập nhật ca trực, trạng thái và khóa liên kết."
        actions={
          <Badge tone={hr.enabled ? 'green' : 'slate'} dot>
            {hr.enabled ? 'Đang bật' : 'Đang tắt'}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-3">
          <CopyField value={webhookUrl} label="HR Webhook URL (GET / POST / OPTIONS, CORS mở)" />

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Field label="Header bảo mật x-hr-secret" hint="Để trống nếu chấp nhận webhook không xác thực (không khuyến nghị).">
              <TextInput value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="hr_..." className="font-mono" />
            </Field>
            <Button variant="secondary" loading={rotating} onClick={() => void rotate()} className="mt-5">
              <KeyRound size={14} />
              Tạo secret mới
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowSample((v) => !v)}>
              <ShieldCheck size={13} />
              {showSample ? 'Ẩn code mẫu JS' : 'Xem code mẫu JS gắn sang app khác'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void patchHr({ enabled: !hr.enabled }, hr.enabled ? 'Đã tắt tích hợp HR.' : 'Đã bật tích hợp HR.')}>
              {hr.enabled ? 'Tắt tích hợp' : 'Bật tích hợp'}
            </Button>
          </div>

          {showSample ? <TextArea readOnly value={sampleCode} className="!min-h-[210px]" onFocus={(e) => e.currentTarget.select()} /> : null}
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
              <Download size={14} className="text-slate-400" />
              Phương án dự phòng: kéo GET API
            </p>
            <div className="space-y-2">
              <Field label="HR API URL (HTTPS)">
                <TextInput value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://hr.ubm.vn/api/schedule" />
              </Field>
              <Field label="API Token (Bearer)">
                <TextInput type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={pulling} onClick={() => void pullNow()}>
                  <RefreshCw size={13} />
                  Kéo dữ liệu HR ngay
                </Button>
                <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
                  Lưu API
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1">
            <Toggle
              label="Tự động tạo nhân viên mới"
              description="Chỉ tạo khi HR trả về người chưa có trong danh sách sale. Không ghi đè Zalo UID/cổng đã gắn."
              checked={hr.autoCreateMissingStaff === true}
              onChange={(value) => void patchHr({ autoCreateMissingStaff: value }, 'Đã lưu tùy chọn tự tạo nhân viên.')}
            />
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
              <UserRoundCheck size={14} className="text-slate-400" />
              Trạng thái đồng bộ gần nhất
            </p>
            <p className="mt-1 text-[11px] text-slate-400">{hr.lastSyncAt ? formatDateTime(hr.lastSyncAt) : 'Chưa đồng bộ lần nào'}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{hr.lastSyncStatus || 'Chưa có dữ liệu.'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
