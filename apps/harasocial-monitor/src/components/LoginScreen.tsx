import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Clock, KeyRound, MessageSquareWarning, ShieldCheck, Users, Zap } from 'lucide-react';
import type { PublicConfig } from '../lib/api';
import { mountGoogleButton } from '../lib/google';
import { Button } from './ui';

const FEATURES = [
  { icon: MessageSquareWarning, title: 'Giám sát đa cổng HaraSocial', text: 'Webhook và API kéo 24/7 cho từng cổng, dữ liệu thật, cô lập theo tài khoản.' },
  { icon: Clock, title: 'SLA & nhắc lặp thông minh', text: 'Cảnh báo lần 1 đúng ngưỡng SLA, nhắc lại mỗi 2 phút cho tới khi nhân viên phản hồi.' },
  { icon: Users, title: 'Phân ca trực GMT+7', text: 'Chỉ @tag người đang trong ca của đúng cổng, tự điều hướng khi người được gán hết ca.' },
  { icon: Zap, title: 'Đồng bộ nhân sự realtime', text: 'Webhook lịch làm việc cập nhật tức thì qua SSE, không làm mất liên kết Zalo.' },
];

export function LoginScreen({
  config,
  loading,
  error,
  onGoogleLogin,
  onGoogleCredential,
  onAccessLogin,
  onDevLogin,
}: {
  config: PublicConfig | null;
  loading: boolean;
  error: string | null;
  onGoogleLogin: () => void;
  onGoogleCredential: (credential: string) => void;
  onAccessLogin: (code: string) => void;
  onDevLogin: () => void;
}) {
  const hasFirebase = !!config?.firebase;
  const hasGoogle = !!config?.auth?.google && !!config?.googleClientId;
  const hasAccess = !!config?.auth?.accessCode;
  const canDev = !!config?.devAuthEnabled;

  const [code, setCode] = useState('');
  const [googleError, setGoogleError] = useState<string | null>(null);
  const googleSlot = useRef<HTMLDivElement>(null);
  const credentialRef = useRef(onGoogleCredential);
  credentialRef.current = onGoogleCredential;

  useEffect(() => {
    if (hasFirebase || !hasGoogle || !config?.googleClientId || !googleSlot.current) return;
    let alive = true;
    void mountGoogleButton(googleSlot.current, config.googleClientId, (credential) => credentialRef.current(credential)).catch((e) => {
      if (alive) setGoogleError((e as Error).message);
    });
    return () => {
      alive = false;
    };
  }, [hasFirebase, hasGoogle, config?.googleClientId]);

  return (
    <div className="flex min-h-full flex-col bg-slate-50 lg:flex-row">
      <div className="relative flex flex-1 flex-col justify-between overflow-hidden bg-slate-900 px-6 py-10 text-white sm:px-10 lg:px-14 lg:py-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(circle at 15% 20%, rgba(16,185,129,0.22), transparent 45%), radial-gradient(circle at 85% 75%, rgba(56,189,248,0.14), transparent 50%)',
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 ring-1 ring-brand-400/30">
              <MessageSquareWarning size={20} className="text-brand-400" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">HaraSocial Zalo Alert</p>
              <p className="text-[11px] text-slate-400">HaraSocial Monitor · UBM</p>
            </div>
          </div>

          <h1 className="mt-10 max-w-xl text-2xl font-semibold leading-snug tracking-tight sm:text-[28px]">
            Không để khách hàng chờ quá hạn phản hồi trên mọi cổng HaraSocial.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
            Tự động @tag đúng nhân viên đang trực vào đúng nhóm Zalo của từng cổng, kèm nhắc lặp cho tới khi
            hội thoại được trả lời.
          </p>

          <ul className="mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                <feature.icon size={16} className="text-brand-400" />
                <p className="mt-2 text-[13px] font-medium text-slate-100">{feature.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{feature.text}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-10 flex items-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck size={14} className="text-slate-500" />
          Dữ liệu cô lập theo tài khoản quản lý · Phiên đăng nhập bảo mật · SSE có Bearer token
        </div>
      </div>

      <div className="flex w-full items-center justify-center px-5 py-12 lg:w-[440px] lg:shrink-0 lg:px-10">
        <div className="w-full max-w-sm">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Đăng nhập quản lý</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            Dùng tài khoản Google của Giám đốc hoặc mã truy cập quản trị do máy chủ cấp.
          </p>

          {error ? (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-relaxed text-rose-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            {hasFirebase ? (
              <Button variant="primary" loading={loading} disabled={loading} onClick={onGoogleLogin} className="w-full">
                Đăng nhập bằng Google
                <ArrowRight size={14} />
              </Button>
            ) : hasGoogle ? (
              <div>
                <div ref={googleSlot} className="flex min-h-[44px] justify-center" />
                {googleError ? (
                  <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 ring-1 ring-amber-200">
                    {googleError} {hasAccess ? 'Hãy dùng mã truy cập bên dưới.' : ''}
                  </p>
                ) : null}
              </div>
            ) : null}

            {hasAccess ? (
              <>
                {hasFirebase || hasGoogle ? (
                  <div className="flex items-center gap-2 py-0.5">
                    <span className="h-px flex-1 bg-slate-200" />
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">hoặc mã truy cập</span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                ) : null}
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (code.trim()) onAccessLogin(code.trim());
                  }}
                >
                  <label className="block text-[11px] font-medium text-slate-600" htmlFor="access-code">
                    Mã truy cập quản trị
                  </label>
                  <div className="relative">
                    <KeyRound size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="access-code"
                      type="password"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Nhập mã do quản trị máy chủ cung cấp"
                      autoComplete="current-password"
                      className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-[13px] text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                  <Button type="submit" variant={hasFirebase || hasGoogle ? 'secondary' : 'primary'} loading={loading} disabled={loading || !code.trim()} className="w-full">
                    Vào bảng giám sát
                    <ArrowRight size={14} />
                  </Button>
                </form>
              </>
            ) : null}

            {!hasFirebase && !hasGoogle && !hasAccess ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 ring-1 ring-amber-200">
                {config?.authError ||
                  'Chưa cấu hình xác thực. Đặt HARA_ACCESS_CODE hoặc GOOGLE_OAUTH_CLIENT_ID / Firebase trong .env rồi khởi động lại máy chủ.'}
              </p>
            ) : null}

            {canDev ? (
              <>
                <div className="flex items-center gap-2 py-1">
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">hoặc chế độ phát triển</span>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
                <Button variant="secondary" loading={loading} disabled={loading} onClick={onDevLogin} className="w-full">
                  Vào bằng tài khoản dev
                </Button>
                <p className="text-center text-[11px] leading-relaxed text-slate-400">
                  Chỉ bật khi <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">HARA_DEV_UID</code> được đặt
                  và NODE_ENV khác production.
                </p>
              </>
            ) : null}
          </div>

          {config && !config.databaseConfigured ? (
            <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
              Máy chủ chưa cấu hình <code className="font-mono">DATABASE_URL</code>. Hãy tạo PostgreSQL, đặt biến môi trường và chạy{' '}
              <code className="font-mono">npm run db:migrate</code>.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
