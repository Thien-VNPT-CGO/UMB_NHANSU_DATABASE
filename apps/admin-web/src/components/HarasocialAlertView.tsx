import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Layers,
  MessageSquareWarning,
  MonitorSmartphone,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Zap,
} from 'lucide-react';

const STORAGE_KEY = 'ubm.harasocial.url';
const DEFAULT_URL =
  (import.meta.env.VITE_HARASOCIAL_URL as string | undefined)?.trim() ||
  (import.meta.env.DEV ? 'http://localhost:3000' : `${window.location.origin}/harasocial/`);

interface HarasocialAlertViewProps {
  showToast?: (message: string, type?: 'INFO' | 'WARNING') => void;
}

const FEATURES = [
  {
    icon: Layers,
    title: 'Đa cổng HaraSocial',
    text: 'Mỗi cổng có webhook riêng và API kéo 24/7 riêng, gắn nhiều nhóm Zalo.',
  },
  {
    icon: Zap,
    title: 'SLA & nhắc lặp',
    text: 'Cảnh báo đúng ngưỡng, nhắc lại mỗi 2 phút cho tới khi nhân viên trả lời.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Ca trực GMT+7',
    text: 'Chỉ @tag người đang trong ca của đúng cổng, tự điều hướng khi hết ca.',
  },
  {
    icon: ShieldCheck,
    title: 'Đồng bộ HR realtime',
    text: 'Webhook lịch làm việc cập nhật tức thì, không mất liên kết Zalo.',
  },
];

export function HarasocialAlertView({ showToast }: HarasocialAlertViewProps) {
  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState('');
  const [embed, setEmbed] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) || DEFAULT_URL;
    setUrl(saved);
    setDraft(saved);
  }, []);

  const configured = useMemo(() => /^https?:\/\//i.test(url), [url]);

  const saveUrl = () => {
    const next = draft.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(next)) {
      showToast?.('Địa chỉ phải bắt đầu bằng http:// hoặc https://', 'WARNING');
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, next);
    setUrl(next);
    setReloadKey((value) => value + 1);
    setCopied(false);
    showToast?.('Đã lưu địa chỉ HaraSocial Monitor.');
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast?.('Trình duyệt không cho phép sao chép tự động.', 'WARNING');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section
        style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 14,
          padding: 18,
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: 12,
                background: '#ECFDF5',
                color: '#047857',
                flexShrink: 0,
              }}
            >
              <MessageSquareWarning size={20} />
            </span>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A' }}>HaraSocial Zalo Alert</h2>
              <p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#64748B', maxWidth: 720, lineHeight: 1.55 }}>
                Giám sát hội thoại khách hàng trên đa cổng HaraSocial 24/7 và tự động @tag nhân viên vào nhóm Zalo khi
                trễ hạn phản hồi (SLA). Hệ thống chạy độc lập với tài khoản UBM HR — đăng nhập một lần bằng Google.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
              disabled={!configured}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid #059669',
                background: '#059669',
                color: '#FFFFFF',
                borderRadius: 9,
                padding: '8px 13px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: configured ? 'pointer' : 'not-allowed',
                opacity: configured ? 1 : 0.55,
              }}
            >
              <ExternalLink size={14} />
              Mở bảng giám sát
            </button>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              disabled={!configured || !embed}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid #E2E8F0',
                background: '#FFFFFF',
                color: '#334155',
                borderRadius: 9,
                padding: '8px 13px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: configured && embed ? 'pointer' : 'not-allowed',
                opacity: configured && embed ? 1 : 0.55,
              }}
            >
              <RefreshCw size={14} />
              Tải lại
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 16 }}>
          {FEATURES.map((feature) => (
            <div key={feature.title} style={{ border: '1px solid #EEF2F6', borderRadius: 10, padding: '9px 11px', background: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0F766E' }}>
                <feature.icon size={14} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>{feature.title}</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 11.5, lineHeight: 1.5, color: '#64748B' }}>{feature.text}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, borderTop: '1px solid #F1F5F9', paddingTop: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
            <label style={{ flex: '1 1 320px', minWidth: 240 }}>
              <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                Địa chỉ ứng dụng HaraSocial Monitor
              </span>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="https://harasocial.ubm.vn"
                spellCheck={false}
                style={{
                  width: '100%',
                  border: '1px solid #E2E8F0',
                  borderRadius: 9,
                  padding: '8px 11px',
                  fontSize: 12.5,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: '#334155',
                  outline: 'none',
                  background: '#FFFFFF',
                }}
              />
            </label>
            <button
              type="button"
              onClick={saveUrl}
              style={{
                border: '1px solid #E2E8F0',
                background: '#F8FAFC',
                color: '#334155',
                borderRadius: 9,
                padding: '8px 13px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Lưu địa chỉ
            </button>
            <button
              type="button"
              onClick={() => void copyUrl()}
              disabled={!configured}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid #E2E8F0',
                background: '#FFFFFF',
                color: '#334155',
                borderRadius: 9,
                padding: '8px 13px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: configured ? 'pointer' : 'not-allowed',
                opacity: configured ? 1 : 0.55,
              }}
            >
              {copied ? <Check size={14} color="#059669" /> : <Copy size={14} />}
              {copied ? 'Đã chép' : 'Chép link'}
            </button>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#475569',
                paddingBottom: 8,
                cursor: 'pointer',
              }}
            >
              <input type="checkbox" checked={embed} onChange={(event) => setEmbed(event.target.checked)} />
              Nhúng trực tiếp trong cổng Giám đốc
            </label>
          </div>

          {!configured ? (
            <p style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: '8px 0 0', fontSize: 11.5, color: '#B45309', lineHeight: 1.55 }}>
              <AlertTriangle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
              Chưa có địa chỉ ứng dụng. Nhập URL máy chủ HaraSocial Monitor (ví dụ http://localhost:3000 khi chạy nội bộ)
              hoặc đặt biến môi trường <code style={{ fontFamily: 'ui-monospace, monospace' }}>VITE_HARASOCIAL_URL</code> khi build cổng quản trị.
            </p>
          ) : null}
        </div>
      </section>

      {configured && embed ? (
        <section
          style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '9px 14px',
              borderBottom: '1px solid #EEF2F6',
              background: '#F8FAFC',
            }}
          >
            <span style={{ fontSize: 11.5, color: '#64748B' }}>
              Khung nhúng · <span style={{ fontFamily: 'ui-monospace, monospace' }}>{url}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#047857' }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: '#10B981' }} />
              Ứng dụng chạy độc lập · đăng nhập Google trong khung
            </span>
          </div>
          <iframe
            key={reloadKey}
            src={url}
            title="HaraSocial Zalo Alert"
            allow="clipboard-read; clipboard-write; popups; fullscreen"
            style={{ width: '100%', height: 'calc(100vh - 340px)', minHeight: 560, border: 'none', display: 'block', background: '#F8FAFC' }}
          />
        </section>
      ) : null}

      <details
        style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          padding: '12px 16px',
          fontSize: 12,
          color: '#475569',
          lineHeight: 1.65,
        }}
      >
        <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#334155' }}>
          <Settings2 size={14} />
          Thiết lập nhanh lần đầu (PostgreSQL · Firebase · Zalo · HR)
        </summary>
        <ol style={{ margin: '10px 0 0', paddingLeft: 20 }}>
          <li>Tạo PostgreSQL, đặt <code>DATABASE_URL</code> trong <code>apps/harasocial-monitor/.env</code> rồi chạy <code>npm run db:migrate</code>.</li>
          <li>Khai báo Firebase Web SDK + service account (hoặc <code>HARA_DEV_UID</code> khi chạy dev) trong cùng file <code>.env</code>.</li>
          <li>Chạy <code>npm run dev --workspace=@ubm/harasocial-monitor</code> (mặc định cổng 3000).</li>
          <li>Trong tab Cài đặt của ứng dụng: đăng nhập Zalo cá nhân bằng QR hoặc Cookie, gắn nhóm Zalo cho từng cổng HaraSocial.</li>
          <li>Sang Web App Nhân sự: dán HR Webhook URL + <code>x-hr-secret</code> để đồng bộ ca trực realtime.</li>
        </ol>
        <p style={{ margin: '8px 0 0', color: '#94A3B8' }}>
          Lưu ý: nếu trình duyệt chặn đăng nhập Google trong iframe, hãy dùng nút “Mở bảng giám sát” để mở tab riêng.
        </p>
      </details>
    </div>
  );
}

export default HarasocialAlertView;
