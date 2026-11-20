import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  Smartphone,
  UserRound,
} from 'lucide-react';
import { endpoints, type PersonalStatus } from '../../lib/api';
import { Badge, Button, Field, Select, SectionHeader, TextArea, TextInput, Toggle, cx } from '../ui';
import type { SectionProps } from './shared';
import { MODE_LABEL } from './shared';

export function ZaloAccountSection({ workspace, toast, refresh }: SectionProps) {
  const [status, setStatus] = useState<PersonalStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [qrBusy, setQrBusy] = useState(false);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [qr, setQr] = useState<PersonalStatus['login']>(null);
  const [showCookie, setShowCookie] = useState(false);
  const [cookie, setCookie] = useState('');
  const [imei, setImei] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [cookieBusy, setCookieBusy] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState(workspace.zalo.webhookUrl || '');
  const [tokenDraft, setTokenDraft] = useState(workspace.zalo.oaToken || '');

  const mode = workspace.zalo.mode;

  const loadStatus = async () => {
    try {
      const next = await endpoints.personalStatus();
      setStatus(next);
      if (next.login && (next.login.phase === 'qr_waiting' || next.login.phase === 'scanned')) {
        setLoginId(next.login.loginId);
        setQr(next.login);
      }
    } catch (e) {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loginId) return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const next = await endpoints.qrStatus(loginId);
        if (!active) return;
        setQr(next);
        if (next && (next.phase === 'connected' || next.phase === 'expired' || next.phase === 'failed')) {
          setLoginId(null);
          if (next.phase === 'connected') {
            toast('Đã kết nối Zalo cá nhân thành công.', 'success');
            await refresh();
            await loadStatus();
          }
        }
      } catch {
        // phiên QR đã kết thúc
      }
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loginId, refresh, toast]);

  const startQr = async () => {
    setQrBusy(true);
    try {
      const { loginId: id } = await endpoints.startQr();
      setLoginId(id);
      setQr({ loginId: id, phase: 'qr_waiting', qrImage: null, startedAt: new Date().toISOString() });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setQrBusy(false);
    }
  };

  const cancelQr = async () => {
    if (!loginId) return;
    try {
      await endpoints.cancelQr(loginId);
    } catch {
      // bỏ qua
    }
    setLoginId(null);
    setQr(null);
  };

  const saveCookieLogin = async () => {
    setCookieBusy(true);
    try {
      const result = await endpoints.cookieLogin({ cookie, imei, userAgent });
      toast(`Đã kết nối Zalo: ${result.account.displayName || result.account.uid}`, 'success');
      setShowCookie(false);
      setCookie('');
      await refresh();
      await loadStatus();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setCookieBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Ngắt kết nối Zalo cá nhân? Hệ thống sẽ không gửi được cảnh báo qua Zalo cá nhân cho tới khi kết nối lại.')) return;
    try {
      await endpoints.disconnect();
      toast('Đã ngắt kết nối Zalo cá nhân.', 'info');
      setStatus(null);
      await loadStatus();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const patchZalo = async (patch: Record<string, unknown>, successMessage?: string) => {
    setSavingMode(true);
    try {
      await endpoints.updateWorkspace({ zalo: { ...workspace.zalo, ...patch } });
      toast(successMessage || 'Đã lưu cấu hình Zalo.', 'success');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSavingMode(false);
    }
  };

  const connected = !!status?.connected;
  const account = status?.account;

  return (
    <div>
      <SectionHeader
        icon={<Smartphone size={17} />}
        title="Tài khoản Zalo gửi cảnh báo"
        description="Chọn phương thức gửi tin nhắn @tag. Với Zalo cá nhân, đăng nhập bằng QR hoặc Cookie + IMEI để tải nhóm và gửi mention thật."
        actions={
          <Badge tone={connected ? 'green' : status?.hasSavedSession ? 'amber' : 'slate'} dot>
            {loadingStatus ? 'Đang kiểm tra…' : connected ? 'Đã kết nối' : status?.hasSavedSession ? 'Có phiên đã lưu' : 'Chưa kết nối'}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3">
          <Field label="Phương thức gửi mặc định" hint="Cổng có Webhook Zalo riêng sẽ ưu tiên webhook của cổng đó.">
            <Select
              value={mode}
              disabled={savingMode}
              onChange={(e) => void patchZalo({ mode: e.target.value }, 'Đã đổi phương thức gửi cảnh báo.')}
            >
              {Object.entries(MODE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          {mode === 'webhook' ? (
            <Field label="Webhook URL (Make / n8n)" hint="Nhận JSON: groupId, groupName, taggedStaff, title, message, text, category.">
              <div className="flex gap-2">
                <TextInput value={webhookDraft} onChange={(e) => setWebhookDraft(e.target.value)} placeholder="https://hook.eu1.make.com/..." />
                <Button variant="primary" disabled={savingMode} onClick={() => void patchZalo({ webhookUrl: webhookDraft.trim() }, 'Đã lưu Webhook URL.')}>
                  Lưu
                </Button>
              </div>
            </Field>
          ) : null}

          {mode === 'oa_group' || mode === 'oa_user' ? (
            <Field label="OA Access Token" hint="Zalo OpenAPI có thể trả HTTP 200 nhưng error khác 0 — hệ thống kiểm tra cả hai.">
              <div className="flex gap-2">
                <TextInput type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="OA access token" />
                <Button variant="primary" disabled={savingMode} onClick={() => void patchZalo({ oaToken: tokenDraft.trim() }, 'Đã lưu OA token.')}>
                  Lưu
                </Button>
              </div>
            </Field>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1">
            <Toggle
              label="Bật cảnh báo khi khách chờ quá hạn"
              description="Tắt để tạm dừng gửi Zalo nhưng vẫn ghi nhận hội thoại."
              checked={workspace.zalo.notifyOnMissChat !== false}
              onChange={(value) => void patchZalo({ notifyOnMissChat: value })}
            />
            <div className="h-px bg-slate-200" />
            <Toggle
              label="Tag toàn bộ nhân viên đang trực cùng ca"
              description="Mặc định chỉ tag người được gán hoặc người trực đầu tiên của cổng."
              checked={workspace.zalo.tagAllOnDutyInShift === true}
              onChange={(value) => void patchZalo({ tagAllOnDutyInShift: value })}
            />
          </div>
        </div>

        <div className="space-y-3">
          {mode === 'personal' ? (
            <>
              <div className="rounded-lg border border-slate-200 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className={cx('flex h-9 w-9 items-center justify-center rounded-full', connected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
                      <UserRound size={16} />
                    </span>
                    <div>
                      <p className="text-[13px] font-medium text-slate-800">
                        {connected ? account?.displayName || account?.uid || 'Zalo cá nhân' : 'Chưa đăng nhập Zalo cá nhân'}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {connected ? `UID ${account?.uid || '—'}` : 'Quét QR bằng ứng dụng Zalo trên điện thoại'}
                      </p>
                    </div>
                  </div>
                  {connected ? (
                    <Button size="sm" variant="danger" onClick={() => void disconnect()}>
                      <LogOut size={13} />
                      Ngắt
                    </Button>
                  ) : null}
                </div>

                {!connected ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" loading={qrBusy} onClick={() => void startQr()}>
                        <QrCode size={14} />
                        Tạo mã QR đăng nhập
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setShowCookie((v) => !v)}>
                        <ChevronDown size={14} className={cx('transition-transform', showCookie && 'rotate-180')} />
                        Dùng Cookie
                      </Button>
                    </div>

                    {qr && loginId ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                        {qr.qrImage ? (
                          <img
                            src={qr.qrImage.startsWith('data:') ? qr.qrImage : `data:image/png;base64,${qr.qrImage}`}
                            alt="Mã QR đăng nhập Zalo"
                            className="mx-auto h-44 w-44 rounded-lg bg-white object-contain p-1 ring-1 ring-slate-200"
                          />
                        ) : (
                          <div className="flex h-44 items-center justify-center">
                            <Loader2 size={22} className="animate-spin text-slate-400" />
                          </div>
                        )}
                        <p className="mt-2 text-[11px] text-slate-500">
                          {qr.phase === 'scanned'
                            ? `Đã quét bởi ${qr.scannedBy?.display_name || 'tài khoản Zalo'} — xác nhận trên điện thoại.`
                            : qr.phase === 'expired'
                              ? 'Mã QR đã hết hạn, hãy tạo mã mới.'
                              : 'Mở Zalo → Cài đặt → Quét mã QR để đăng nhập.'}
                        </p>
                        <Button size="sm" variant="ghost" className="mt-1" onClick={() => void cancelQr()}>
                          Hủy phiên QR
                        </Button>
                      </div>
                    ) : null}

                    {showCookie ? (
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <Field label="Cookie (JSON)" hint="Dán nguyên mảng cookie lấy từ trình duyệt đã đăng nhập Zalo Web.">
                          <TextArea value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder='[{"name":"...","value":"..."}]' />
                        </Field>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Field label="IMEI">
                            <TextInput value={imei} onChange={(e) => setImei(e.target.value)} placeholder="imei" />
                          </Field>
                          <Field label="User-Agent">
                            <TextInput value={userAgent} onChange={(e) => setUserAgent(e.target.value)} placeholder="Mozilla/5.0 ..." />
                          </Field>
                        </div>
                        <Button
                          size="sm"
                          variant="primary"
                          loading={cookieBusy}
                          disabled={!cookie.trim() || !imei.trim() || !userAgent.trim()}
                          onClick={() => void saveCookieLogin()}
                        >
                          <Check size={14} />
                          Kết nối bằng Cookie
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {status?.lastError && !connected ? (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-600">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    {status.lastError}
                  </p>
                ) : null}
              </div>
              <Button size="sm" variant="ghost" onClick={() => void loadStatus()}>
                <RefreshCw size={13} className={loadingStatus ? 'animate-spin' : undefined} />
                Kiểm tra lại kết nối
              </Button>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-[12px] leading-relaxed text-slate-500">
              <p className="font-medium text-slate-700">{MODE_LABEL[mode]}</p>
              <p className="mt-1">
                {mode === 'webhook'
                  ? 'Cảnh báo được đẩy sang Make/n8n; workflow của bạn chịu trách nhiệm gửi vào nhóm Zalo bằng bot hoặc OA.'
                  : 'Cảnh báo gửi trực tiếp qua Zalo OpenAPI bằng OA access token ở cột bên trái.'}
              </p>
            </div>
          )}

          <div className="grid gap-3 rounded-lg border border-slate-200 p-3.5 sm:grid-cols-2">
            <Field label="Chu kỳ nhắc lại" hint="0 = chỉ cảnh báo 1 lần.">
              <Select
                value={workspace.repeatAlertIntervalMinutes}
                disabled={savingMode}
                onChange={(e) =>
                  void (async () => {
                    try {
                      await endpoints.updateWorkspace({ repeatAlertIntervalMinutes: Number(e.target.value) });
                      toast('Đã lưu chu kỳ nhắc lại.', 'success');
                      await refresh();
                    } catch (err) {
                      toast((err as Error).message, 'error');
                    }
                  })()
                }
              >
                <option value={0}>Tắt nhắc lại</option>
                <option value={1}>Mỗi 1 phút</option>
                <option value={2}>Mỗi 2 phút</option>
                <option value={3}>Mỗi 3 phút</option>
                <option value={5}>Mỗi 5 phút</option>
                <option value={10}>Mỗi 10 phút</option>
              </Select>
            </Field>
            <div className="rounded-lg bg-slate-50 px-3 py-1">
              <Toggle
                label="Worker 24/7"
                description="Quét SLA mỗi 30 giây."
                checked={workspace.cloudWorkerEnabled !== false}
                onChange={(value) =>
                  void (async () => {
                    try {
                      await endpoints.updateWorkspace({ cloudWorkerEnabled: value });
                      toast(value ? 'Đã bật worker 24/7.' : 'Đã tạm dừng worker.', 'info');
                      await refresh();
                    } catch (err) {
                      toast((err as Error).message, 'error');
                    }
                  })()
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
