import { useState } from 'react';
import { AlertTriangle, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { endpoints } from '../../lib/api';
import { Badge, Button, CopyField, Field, SectionHeader, TextInput } from '../ui';
import type { SectionProps } from './shared';

export function SecuritySection({ workspace, baseUrl, refresh, toast }: SectionProps) {
  const [secret, setSecret] = useState(workspace.harasocialWebhookSecret || '');
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [clearing, setClearing] = useState(false);

  const webhookUrl = `${baseUrl}/api/webhooks/harasocial?workspace=${encodeURIComponent(workspace.ownerUid)}`;

  const save = async () => {
    setSaving(true);
    try {
      await endpoints.updateWorkspace({ harasocialWebhookSecret: secret.trim() });
      toast('Đã lưu secret webhook HaraSocial.', 'success');
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
      const result = await endpoints.rotateSecret('harasocial');
      setSecret(result.secret);
      toast('Đã tạo secret mới. Cập nhật lại header ở HaraSocial / Make.com.', 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRotating(false);
    }
  };

  const clear = async () => {
    if (!window.confirm('Xóa toàn bộ hội thoại và lịch sử cảnh báo của tài khoản này? Hành động không thể hoàn tác.')) return;
    setClearing(true);
    try {
      const result = await endpoints.clearData();
      toast(`Đã xóa ${result.conversations} hội thoại và ${result.logs} bản ghi cảnh báo.`, 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div>
      <SectionHeader
        icon={<ShieldCheck size={17} />}
        title="Bảo mật webhook & dữ liệu"
        description="Webhook công khai nhưng được bảo vệ bằng secret. Mọi endpoint API khác đều yêu cầu Bearer token Firebase và cô lập theo ownerUid."
        actions={
          <Badge tone={secret ? 'green' : 'amber'} dot>
            {secret ? 'Đã đặt secret' : 'Chưa có secret'}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <CopyField value={webhookUrl} label="Webhook HaraSocial chung (chưa kèm channelKey)" />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Field label="x-harasocial-secret" hint="Gửi kèm header khi HaraSocial / Make.com gọi webhook.">
              <TextInput value={secret} onChange={(e) => setSecret(e.target.value)} className="font-mono" placeholder="hs_..." />
            </Field>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" loading={saving} onClick={() => void save()}>
                Lưu
              </Button>
              <Button variant="secondary" loading={rotating} onClick={() => void rotate()}>
                <KeyRound size={14} />
                Tạo mới
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3.5">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-rose-700">
            <AlertTriangle size={14} />
            Xóa dữ liệu để chạy thật
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-rose-600/90">
            Hệ thống không sinh dữ liệu mẫu. Nút này xóa sạch hội thoại và nhật ký cảnh báo hiện có để bạn bắt đầu giám sát bằng nguồn thật.
          </p>
          <Button variant="danger" className="mt-3" loading={clearing} onClick={() => void clear()}>
            <Trash2 size={14} />
            Xóa toàn bộ hội thoại &amp; nhật ký
          </Button>
        </div>
      </div>
    </div>
  );
}
