import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, Search, X } from 'lucide-react';

export function money(value: unknown): string {
  const n = Number(value);
  return `${(Number.isFinite(n) ? Math.round(n) : 0).toLocaleString('vi-VN')}đ`;
}

export function compactMoney(value: unknown): string {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)} tỷ`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)} tr`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return money(n);
}

export function formatDate(value?: string | null): string {
  const raw = String(value || '').slice(0, 10);
  const [y, m, d] = raw.split('-');
  return d && m && y ? `${d}/${m}/${y}` : '—';
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function monthLabel(period?: string | null): string {
  const raw = String(period || '').slice(0, 7);
  const [y, m] = raw.split('-');
  return y && m ? `Tháng ${m}/${y}` : '—';
}

export function todayIso(): string {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  return vn.toISOString().slice(0, 10);
}

export function currentPeriod(): string {
  return todayIso().slice(0, 7);
}

export function initials(name?: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'UB';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[parts.length - 2][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ViewHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="view-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="view-header-actions">{actions}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <Loader2 size={22} className="spin" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Tìm kiếm...',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={16} />
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label="Xóa tìm kiếm">
          <X size={14} />
        </button>
      ) : null}
    </label>
  );
}

// Nhiều modal có thể mở chồng nhau (chi tiết + xác nhận). Đếm tham chiếu để
// modal đóng sau cùng mới trả lại trạng thái cuộn của body.
let openModalCount = 0;
let bodyOverflowBeforeModal = '';

function lockBodyScroll() {
  if (openModalCount === 0) bodyOverflowBeforeModal = document.body.style.overflow;
  openModalCount += 1;
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) document.body.style.overflow = bodyOverflowBeforeModal;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unlockBodyScroll();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Hủy',
  tone = 'gold',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'gold' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-gold'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 size={16} className="spin" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className={`confirm-message ${tone === 'danger' ? 'is-danger' : ''}`}>
        {tone === 'danger' ? <AlertTriangle size={20} /> : null}
        <div>{message}</div>
      </div>
    </Modal>
  );
}
