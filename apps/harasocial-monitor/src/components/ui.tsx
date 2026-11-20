import { useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, Inbox, Loader2 } from 'lucide-react';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ card */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', padded && 'p-4 sm:p-5', className)}>
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  description,
  icon,
  actions,
  tone = 'brand',
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  tone?: 'brand' | 'slate' | 'amber';
}) {
  const toneClass =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-600 ring-amber-100'
      : tone === 'slate'
        ? 'bg-slate-100 text-slate-600 ring-slate-200'
        : 'bg-brand-50 text-brand-600 ring-brand-100';
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon ? <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1', toneClass)}>{icon}</span> : null}
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-900 sm:text-[15px]">{title}</h2>
          {description ? <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  loading,
  type = 'button',
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  className?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap';
  const sizes = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-[13px]';
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    subtle: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    danger: 'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50',
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      className={cx(base, sizes, variants[variant], className)}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- input */

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      {label ? <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span> : null}
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{hint}</span> : null}
    </label>
  );
}

const inputBase =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-400';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputBase, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputBase, 'min-h-[76px] resize-y font-mono text-xs leading-relaxed', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputBase, 'cursor-pointer pr-8', props.className)} />;
}

/* ---------------------------------------------------------------- toggle */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <p className="text-[13px] font-medium text-slate-700">{label}</p>
        {description ? <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-slate-300'
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- badge */

type BadgeTone = 'green' | 'amber' | 'red' | 'slate' | 'blue' | 'violet';

const badgeTones: Record<BadgeTone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function Badge({
  children,
  tone = 'slate',
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  const dotColors: Record<BadgeTone, string> = {
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-rose-500',
    slate: 'bg-slate-400',
    blue: 'bg-sky-500',
    violet: 'bg-violet-500',
  };
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', badgeTones[tone], className)}>
      {dot ? <span className={cx('h-1.5 w-1.5 rounded-full', dotColors[tone])} /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ copy field */

export function CopyField({
  value,
  label,
  mono = true,
  onCopied,
}: {
  value: string;
  label?: string;
  mono?: boolean;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.();
    } catch {
      // Trình duyệt cũ: chọn toàn bộ nội dung để người dùng copy tay.
      const input = document.getElementById(`copy-${label || value.slice(0, 12)}`) as HTMLInputElement | null;
      input?.select();
    }
  };

  return (
    <div>
      {label ? <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span> : null}
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          id={`copy-${label || value.slice(0, 12)}`}
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={cx(
            'min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600',
            mono && 'font-mono'
          )}
        />
        <Button variant="secondary" size="sm" onClick={copy} title="Sao chép">
          {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          {copied ? 'Đã chép' : 'Chép'}
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- empty */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
      <Inbox size={22} className="text-slate-300" />
      <p className="text-[13px] font-medium text-slate-600">{title}</p>
      {description ? <p className="max-w-md text-xs leading-relaxed text-slate-400">{description}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={16} className={cx('animate-spin text-slate-400', className)} />;
}
