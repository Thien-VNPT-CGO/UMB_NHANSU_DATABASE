import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCheck,
  CircleAlert,
  Info,
  LogOut,
  Menu,
  MessageSquareWarning,
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { LoginScreen } from './components/LoginScreen';
import { MonitorTab } from './components/MonitorTab';
import { SettingsTab } from './components/settings/SettingsTab';
import type { ToastTone } from './components/settings/shared';
import { Badge, Button, Card, Spinner, cx } from './components/ui';
import {
  ApiError,
  endpoints,
  openEventStream,
  setTokenGetter,
  type BootstrapPayload,
  type PublicConfig,
} from './lib/api';
import { initFirebase, getIdToken, signInWithGoogle, signOutGoogle, watchAuth, authErrorVi } from './lib/firebase';
import { formatTime, initials } from './lib/format';

type Session = { kind: 'firebase' } | { kind: 'dev'; token: string } | { kind: 'session'; token: string };
type TabKey = 'monitor' | 'settings';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const DEV_TOKEN_KEY = 'hara_dev_token';
const SESSION_TOKEN_KEY = 'hara_session_token';

export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [tab, setTab] = useState<TabKey>('monitor');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [trustedBase, setTrustedBase] = useState<string>('');

  const [busy, setBusy] = useState<{ sync?: boolean; scan?: boolean; replyId?: string; alertId?: string }>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(1);
  const refreshTimer = useRef<number | null>(null);

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = toastId.current++;
    setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, tone === 'error' ? 7000 : 4500);
  }, []);

  /* ------------------------------------------------------------ cấu hình */
  useEffect(() => {
    let alive = true;
    endpoints
      .publicConfig()
      .then((cfg) => {
        if (!alive) return;
        setConfig(cfg);
        if (cfg.firebase) {
          initFirebase(cfg.firebase);
          const savedSession = window.localStorage.getItem(SESSION_TOKEN_KEY);
          if (savedSession) setSession({ kind: 'session', token: savedSession });
          watchAuth((user) => {
            if (!alive) return;
            // Phiên HMAC (Google/mã truy cập) ưu tiên hơn trạng thái Firebase.
            if (!window.localStorage.getItem(SESSION_TOKEN_KEY)) {
              setSession(user ? { kind: 'firebase' } : null);
            }
            setAuthReady(true);
          });
        } else {
          const savedSession = window.localStorage.getItem(SESSION_TOKEN_KEY);
          if (savedSession) {
            setSession({ kind: 'session', token: savedSession });
          } else {
            const saved = window.localStorage.getItem(DEV_TOKEN_KEY);
            if (saved && cfg.devAuthEnabled) setSession({ kind: 'dev', token: saved });
          }
          setAuthReady(true);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setConfigError((e as Error).message);
        setAuthReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  /* --------------------------------------------------------------- token */
  useEffect(() => {
    if (!session) {
      setTokenGetter(null);
      return;
    }
    if (session.kind === 'dev' || session.kind === 'session') {
      setTokenGetter(async () => session.token);
    } else {
      setTokenGetter(() => getIdToken());
    }
  }, [session]);

  /* ------------------------------------------------------------ bootstrap */
  const loadBootstrap = useCallback(async () => {
    const payload = await endpoints.bootstrap();
    setData(payload);
    setLoadError(null);
    const base = payload.baseUrl || window.location.origin;
    setTrustedBase(base);
    return payload;
  }, []);

  const loadRef = useRef(loadBootstrap);
  loadRef.current = loadBootstrap;

  useEffect(() => {
    if (!session) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    endpoints
      .bootstrap()
      .then((payload) => {
        if (!alive) return;
        setData(payload);
        setTrustedBase(payload.baseUrl || window.location.origin);
      })
      .catch((e) => {
        if (!alive) return;
        const error = e as ApiError;
        setLoadError(error.message);
        if (error.status === 401) {
          if (session.kind === 'dev') {
            window.localStorage.removeItem(DEV_TOKEN_KEY);
            setSession(null);
            setAuthError('Phiên dev đã hết hiệu lực. Hãy đăng nhập lại.');
          } else if (session.kind === 'session') {
            window.localStorage.removeItem(SESSION_TOKEN_KEY);
            setSession(null);
            setAuthError('Phiên đăng nhập đã hết hiệu lực. Hãy đăng nhập lại.');
          } else {
            void signOutGoogle().finally(() => setSession(null));
          }
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [session]);

  /* ----------------------------------------------------------------- SSE */
  useEffect(() => {
    if (!session || !data) return;
    const close = openEventStream({
      onStatus: setStreaming,
      onEvent: (event, payload) => {
        if (event === 'ready') return;
        if (['conversations', 'staff', 'workspace', 'hr', 'channels', 'logs', 'sla'].includes(event)) {
          if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
          refreshTimer.current = window.setTimeout(() => {
            void loadRef.current().catch(() => undefined);
          }, 250);
          if (event === 'hr' && payload && typeof payload === 'object') {
            const summary = payload as { matched?: number; created?: number };
            if ((summary.matched || 0) + (summary.created || 0) > 0) {
              toast(`Lịch làm việc vừa đồng bộ: khớp ${summary.matched || 0}, tạo ${summary.created || 0}.`, 'info');
            }
          }
        }
      },
    });
    return () => {
      close();
      setStreaming(false);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, [session, !!data, toast]);

  /* --------------------------------------------------------- đồng hồ live */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* -------------------------------------------------------------- actions */
  const refresh = useCallback(async () => {
    await loadBootstrap();
  }, [loadBootstrap]);

  const handleGoogle = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      const code = String((e as { code?: string }).code || '');
      setAuthError(authErrorVi(code));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleDev = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await endpoints.devLogin();
      window.localStorage.setItem(DEV_TOKEN_KEY, result.token);
      setSession({ kind: 'dev', token: result.token });
    } catch (e) {
      setAuthError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAccessLogin = async (code: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await endpoints.accessLogin(code);
      window.localStorage.setItem(SESSION_TOKEN_KEY, result.token);
      setSession({ kind: 'session', token: result.token });
    } catch (e) {
      setAuthError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await endpoints.googleLogin(credential);
      window.localStorage.setItem(SESSION_TOKEN_KEY, result.token);
      setSession({ kind: 'session', token: result.token });
    } catch (e) {
      setAuthError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    if (session?.kind === 'dev') window.localStorage.removeItem(DEV_TOKEN_KEY);
    else await signOutGoogle().catch(() => undefined);
    setSession(null);
    setData(null);
  };

  const handleSla = async (minutes: number) => {
    try {
      await endpoints.updateWorkspace({ slaThresholdMinutes: minutes });
      toast(`Đã đổi ngưỡng SLA toàn hệ thống thành ${minutes} phút.`, 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const handleSync = async () => {
    setBusy((b) => ({ ...b, sync: true }));
    try {
      const result = await endpoints.syncHarasocial();
      const failed = result.channels.filter((c) => !c.ok);
      if (result.channels.length === 0) {
        toast('Chưa có cổng nào được cấu hình API kéo 24/7.', 'info');
      } else if (failed.length === 0) {
        toast(`Đồng bộ xong ${result.channels.length} cổng · ${result.total} hội thoại.`, 'success');
      } else {
        toast(`Đồng bộ ${result.channels.length - failed.length}/${result.channels.length} cổng. Lỗi: ${failed.map((f) => `${f.channelName}: ${f.error}`).join(' | ')}`, 'error');
      }
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy((b) => ({ ...b, sync: false }));
    }
  };

  const handleScan = async () => {
    setBusy((b) => ({ ...b, scan: true }));
    try {
      const result = await endpoints.runSla();
      if (result.due === 0) {
        toast(`Đã quét ${result.scanned} hội thoại — chưa có hội thoại nào tới hạn cảnh báo.`, 'info');
      } else {
        toast(`Đã xử lý ${result.due} hội thoại tới hạn · ${result.alerted} gửi thành công · ${result.failures} thất bại.`, result.failures ? 'error' : 'success');
      }
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy((b) => ({ ...b, scan: false }));
    }
  };

  const handleReply = async (id: string) => {
    setBusy((b) => ({ ...b, replyId: id }));
    try {
      await endpoints.reply(id);
      toast('Đã đánh dấu hội thoại là đã trả lời. Chu kỳ cảnh báo được đặt lại.', 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy((b) => ({ ...b, replyId: undefined }));
    }
  };

  const handleAlert = async (id: string) => {
    setBusy((b) => ({ ...b, alertId: id }));
    try {
      const result = await endpoints.alertNow(id);
      if (result.ok) toast(`Đã gửi cảnh báo tới ${result.detail.groups} nhóm · tag: ${result.detail.targets.join(', ') || 'không có ai trong ca'}.`, 'success');
      else toast(`Gửi cảnh báo thất bại: ${result.detail.errors.join('; ') || 'kiểm tra cấu hình Zalo.'}`, 'error');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy((b) => ({ ...b, alertId: undefined }));
    }
  };

  /* ----------------------------------------------------------------- view */
  const user = data?.user;
  const workspace = data?.workspace;
  const userLabel = user?.displayName || user?.email || 'Tài khoản quản lý';
  const tabs = useMemo(
    () =>
      [
        { key: 'monitor' as const, label: 'Giám sát HaraSocial', icon: Activity },
        { key: 'settings' as const, label: 'Cài đặt Zalo & Nhân viên', icon: Settings },
      ] as const,
    []
  );

  if (!authReady && !configError) {
    return <SplashView message="Đang khởi động HaraSocial Monitor…" />;
  }

  if (configError) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <Card className="max-w-lg">
          <div className="flex items-center gap-2 text-rose-600">
            <CircleAlert size={18} />
            <p className="text-sm font-semibold">Không kết nối được máy chủ</p>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500">{configError}</p>
          <Button variant="secondary" className="mt-4" onClick={() => window.location.reload()}>
            <RefreshCw size={14} />
            Thử lại
          </Button>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        config={config}
        loading={authBusy}
        error={authError}
        onGoogleLogin={() => void handleGoogle()}
        onGoogleCredential={(credential) => void handleGoogleCredential(credential)}
        onAccessLogin={(code) => void handleAccessLogin(code)}
        onDevLogin={() => void handleDev()}
      />
    );
  }

  if (!data) {
    return loadError ? (
      <div className="flex min-h-full items-center justify-center p-6">
        <Card className="max-w-lg">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle size={18} />
            <p className="text-sm font-semibold">Chưa tải được dữ liệu tài khoản</p>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-500">{loadError}</p>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" loading={loading} onClick={() => void refresh().catch((e) => toast((e as Error).message, 'error'))}>
              <RefreshCw size={14} />
              Thử lại
            </Button>
            <Button variant="secondary" onClick={() => void handleSignOut()}>
              <LogOut size={14} />
              Đăng xuất
            </Button>
          </div>
        </Card>
      </div>
    ) : (
      <SplashView message="Đang tải cấu hình tài khoản…" />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1440px] items-center gap-3 px-3 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-brand-400">
              <MessageSquareWarning size={17} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold leading-tight text-slate-900">HaraSocial Zalo Alert</p>
              <p className="hidden truncate text-[10px] text-slate-400 sm:block">Giám sát hội thoại đa cổng · cảnh báo SLA qua Zalo</p>
            </div>
          </div>

          <nav className="ml-2 hidden items-center gap-1 rounded-lg bg-slate-100 p-0.5 md:flex">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={cx(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
                  tab === item.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <item.icon size={14} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] text-slate-400 lg:flex">
              {streaming ? <Wifi size={13} className="text-emerald-500" /> : <WifiOff size={13} className="text-slate-300" />}
              <span className="tabular-nums">{formatTime(new Date(now).toISOString())}</span>
            </span>
            <Badge tone={workspace?.cloudWorkerEnabled ? 'green' : 'amber'} dot className="hidden sm:inline-flex">
              Worker {workspace?.cloudWorkerEnabled ? '24/7' : 'tắt'}
            </Badge>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 md:hidden"
              aria-label="Mở menu"
            >
              <Menu size={16} />
            </button>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 py-1 pl-1 pr-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-[10px] font-semibold text-brand-700">
                {initials(userLabel)}
              </span>
              <div className="hidden min-w-0 leading-tight sm:block">
                <p className="max-w-[160px] truncate text-[11px] font-medium text-slate-700">{userLabel}</p>
                <p className="max-w-[160px] truncate text-[10px] text-slate-400">{user?.email || 'dev'}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Đăng xuất"
                aria-label="Đăng xuất"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[1440px] gap-1 overflow-x-auto px-3 pb-2 md:hidden">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cx(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium',
                tab === item.key ? 'bg-brand-50 text-brand-700' : 'text-slate-500'
              )}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-3 py-4 sm:px-5 sm:py-5">
        {loadError ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span className="flex-1">{loadError}</span>
            <button type="button" onClick={() => setLoadError(null)} className="text-amber-600 hover:text-amber-800" aria-label="Đóng">
              <X size={14} />
            </button>
          </div>
        ) : null}

        {tab === 'monitor' ? (
          <MonitorTab
            workspace={data.workspace}
            staff={data.staff}
            conversations={data.conversations}
            logs={data.logs}
            now={now}
            streaming={streaming}
            busy={busy}
            onSync={() => void handleSync()}
            onScan={() => void handleScan()}
            onReply={(id) => void handleReply(id)}
            onAlert={(id) => void handleAlert(id)}
            onChangeSla={(minutes) => void handleSla(minutes)}
          />
        ) : (
          <SettingsTab
            workspace={data.workspace}
            staff={data.staff}
            logs={data.logs}
            baseUrl={trustedBase || data.baseUrl}
            now={now}
            refresh={refresh}
            toast={toast}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white/70">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[10px] text-slate-400 sm:px-5">
          <span>
            HaraSocial Zalo Alert v{config?.version || '1.0.0'} · Dữ liệu cô lập theo tài khoản · Giờ Việt Nam UTC+7
          </span>
          <span className="flex items-center gap-3">
            <span className={cx('inline-flex items-center gap-1', streaming ? 'text-emerald-600' : 'text-slate-400')}>
              {streaming ? <CheckCheck size={12} /> : <WifiOff size={12} />}
              {streaming ? 'SSE realtime' : 'Mất realtime'}
            </span>
            {data.worker.lastRunAt ? <span className="tabular-nums">Quét gần nhất {formatTime(data.worker.lastRunAt)}</span> : null}
          </span>
        </div>
      </footer>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu di động">
          <button type="button" aria-label="Đóng menu" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-slate-900/40" />
          <div className="absolute right-0 top-0 flex h-full w-[280px] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold text-slate-900">HaraSocial Monitor</p>
                <p className="text-[10px] text-slate-400">{userLabel}</p>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Đóng">
                <X size={16} />
              </button>
            </div>

            <nav className="flex flex-col gap-1 p-2">
              {tabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setTab(item.key);
                    setDrawerOpen(false);
                  }}
                  className={cx(
                    'flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium',
                    tab === item.key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <item.icon size={15} />
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="mt-auto space-y-3 border-t border-slate-100 p-4">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Realtime</span>
                <span className={cx('inline-flex items-center gap-1 font-medium', streaming ? 'text-emerald-600' : 'text-slate-400')}>
                  {streaming ? <Wifi size={12} /> : <WifiOff size={12} />}
                  {streaming ? 'Đang kết nối' : 'Mất kết nối'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Worker 24/7</span>
                <Badge tone={workspace?.cloudWorkerEnabled ? 'green' : 'amber'} dot>
                  {workspace?.cloudWorkerEnabled ? 'Bật' : 'Tắt'}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Quét gần nhất</span>
                <span className="tabular-nums text-slate-600">{data.worker.lastRunAt ? formatTime(data.worker.lastRunAt) : '—'}</span>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setDrawerOpen(false);
                  void handleSignOut();
                }}
              >
                <LogOut size={14} />
                Đăng xuất
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-[min(360px,calc(100vw-24px))] flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cx(
              'pointer-events-auto flex items-start gap-2 rounded-lg border bg-white px-3 py-2.5 text-[12px] leading-relaxed shadow-lg',
              item.tone === 'error' ? 'border-rose-200 text-rose-700' : item.tone === 'info' ? 'border-sky-200 text-sky-700' : 'border-emerald-200 text-emerald-700'
            )}
          >
            {item.tone === 'error' ? <CircleAlert size={15} className="mt-0.5 shrink-0" /> : item.tone === 'info' ? <Info size={15} className="mt-0.5 shrink-0" /> : <CheckCheck size={15} className="mt-0.5 shrink-0" />}
            <span className="flex-1">{item.message}</span>
            <button type="button" onClick={() => setToasts((prev) => prev.filter((t) => t.id !== item.id))} className="opacity-50 hover:opacity-100" aria-label="Đóng">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SplashView({ message }: { message: string }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-slate-50">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-brand-400">
        <MessageSquareWarning size={20} />
      </span>
      <div className="flex items-center gap-2 text-[12px] text-slate-500">
        <Spinner />
        {message}
      </div>
    </div>
  );
}
