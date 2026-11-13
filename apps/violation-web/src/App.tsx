import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Gavel,
  Landmark,
  LayoutDashboard,
  Loader2,
  LogOut,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { fetchMe, getToken, setToken } from './services/api';
import { connectViolationRealtime, type RealtimeStatus } from './services/realtime';
import type { AuthResult, ViolationAccount, ViewKey } from './types';
import { LoginScreen } from './components/LoginScreen';
import { PinChangeView } from './components/PinChangeView';
import { Dashboard } from './components/Dashboard';
import { RegulationsView } from './components/RegulationsView';
import { CatchViolationView } from './components/CatchViolationView';
import { TicketsView } from './components/TicketsView';
import { AdjustRegulationsView } from './components/AdjustRegulationsView';
import { ProfileView } from './components/ProfileView';
import { initials } from './components/ui';

const VIEW_LABELS: Record<ViewKey, string> = {
  dashboard: 'Trung tâm điều hành',
  regulations: 'Quy chế Công Ty',
  catch: 'Bắt lỗi vi phạm',
  pending: 'Lỗi vi phạm chưa duyệt',
  approved: 'Lỗi vi phạm đã duyệt',
  adjust: 'Điều chỉnh quy chế',
  'change-pin': 'Đổi mật khẩu',
  profile: 'Thông tin cá nhân',
};

const REALTIME_LABEL: Record<RealtimeStatus, string> = {
  connecting: 'Đang kết nối',
  online: 'Realtime',
  offline: 'Ngoại tuyến',
};

export function App() {
  const [booting, setBooting] = useState(true);
  const [account, setAccount] = useState<ViolationAccount | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [knownPin, setKnownPin] = useState('');
  const [view, setView] = useState<ViewKey>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const [realtime, setRealtime] = useState<RealtimeStatus>('connecting');
  const [notice, setNotice] = useState('');

  const bumpRefresh = useCallback(() => setRefreshKey(value => value + 1), []);

  useEffect(() => {
    const existing = getToken();
    if (!existing) {
      setBooting(false);
      return;
    }
    let alive = true;
    fetchMe()
      .then(nextAccount => {
        if (!alive) return;
        setAccount(nextAccount);
        setMustChange(nextAccount.must_change_pin === true);
      })
      .catch(() => {
        if (alive) setToken(null);
      })
      .finally(() => {
        if (alive) setBooting(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const leaveSession = useCallback((message?: string) => {
    setToken(null);
    setAccount(null);
    setMustChange(false);
    setKnownPin('');
    setView('dashboard');
    setRealtime('connecting');
    setNotice(message || '');
  }, []);

  useEffect(() => {
    const onAuthEvent = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type;
      if (type === 'pin-required') {
        setMustChange(true);
      } else if (type === 'unauthorized') {
        leaveSession('Phiên đăng nhập không hợp lệ hoặc đã bị thu hồi. Vui lòng đăng nhập lại.');
      }
    };
    window.addEventListener('violation:auth', onAuthEvent);
    return () => window.removeEventListener('violation:auth', onAuthEvent);
  }, [leaveSession]);

  useEffect(() => {
    if (!account || mustChange) return;
    const stop = connectViolationRealtime(getToken(), {
      onUpdate: bumpRefresh,
      onStatus: setRealtime,
      onAuthError: () => leaveSession('Phiên đăng nhập đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại.'),
    });
    return stop;
  }, [account, mustChange, bumpRefresh, leaveSession]);

  const handleLogin = (result: AuthResult, pin: string) => {
    setToken(result.token);
    setAccount(result.account);
    setKnownPin(pin);
    setMustChange(result.mustChangePin || result.account.must_change_pin === true);
    setNotice('');
    setView('dashboard');
  };

  const handlePinChanged = (result: AuthResult, newPin: string) => {
    setToken(result.token);
    setAccount(result.account);
    setKnownPin(newPin);
    setMustChange(false);
  };

  const handlePinReset = (message: string) => {
    leaveSession(message);
  };

  const navigate = (next: ViewKey) => {
    setView(next);
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  };

  const handleSaved = (status: 'PENDING' | 'APPROVED') => {
    bumpRefresh();
    navigate(status === 'PENDING' ? 'pending' : 'approved');
  };

  const currentLabel = useMemo(() => VIEW_LABELS[view], [view]);

  if (booting) {
    return (
      <div className="splash-screen">
        <div className="login-aurora" aria-hidden="true" />
        <div className="splash-seal">
          <Landmark size={38} />
        </div>
        <strong>TÒA ÁN TỐI CAO ỤM BÒ MILK</strong>
        <span>
          <Loader2 size={16} className="spin" /> Đang mở phiên làm việc...
        </span>
      </div>
    );
  }

  if (!account) {
    return <LoginScreen onSuccess={handleLogin} notice={notice} />;
  }

  if (mustChange) {
    return (
      <PinChangeView
        account={account}
        forced
        knownPin={knownPin}
        onChanged={handlePinChanged}
        onReset={handlePinReset}
        onLogout={() => leaveSession('')}
      />
    );
  }

  const renderView = () => {
    switch (view) {
      case 'regulations':
        return <RegulationsView refreshKey={refreshKey} onAdjust={() => navigate('adjust')} />;
      case 'catch':
        return <CatchViolationView refreshKey={refreshKey} onSaved={handleSaved} />;
      case 'pending':
        return <TicketsView status="PENDING" refreshKey={refreshKey} />;
      case 'approved':
        return <TicketsView status="APPROVED" refreshKey={refreshKey} />;
      case 'adjust':
        return <AdjustRegulationsView refreshKey={refreshKey} />;
      case 'change-pin':
        return (
          <div className="view view-narrow">
            <PinChangeView
              account={account}
              knownPin={knownPin}
              onChanged={handlePinChanged}
              onReset={handlePinReset}
              onLogout={() => leaveSession('')}
            />
          </div>
        );
      case 'profile':
        return <ProfileView account={account} />;
      default:
        return <Dashboard account={account} refreshKey={refreshKey} onNavigate={navigate} />;
    }
  };

  return (
    <div className="app-shell">
      <div className="app-bg" aria-hidden="true" />
      <header className="app-header">
        <button type="button" className="app-brand" onClick={() => navigate('dashboard')} aria-label="Về trang chủ">
          <span className="app-brand-seal">
            <Landmark size={20} />
          </span>
          <span className="app-brand-copy">
            <strong>Tòa Án Tối Cao</strong>
            <span>Ụm Bò Milk · Kiểm soát vi phạm</span>
          </span>
        </button>

        <div className="app-header-center">
          {view !== 'dashboard' ? (
            <button type="button" className="btn btn-ghost btn-sm header-back" onClick={() => navigate('dashboard')}>
              <ArrowLeft size={15} /> Trang chủ
            </button>
          ) : (
            <span className="header-context">
              <LayoutDashboard size={14} /> {currentLabel}
            </span>
          )}
          {view !== 'dashboard' ? <span className="header-context header-context-muted">{currentLabel}</span> : null}
        </div>

        <div className="app-header-right">
          <span className={`realtime-pill realtime-${realtime}`}>
            {realtime === 'online' ? <Wifi size={13} /> : <WifiOff size={13} />}
            {REALTIME_LABEL[realtime]}
          </span>

          <div className="header-account">
            <span className="mini-avatar">{initials(account.display_name)}</span>
            <span className="header-account-copy">
              <strong>{account.display_name}</strong>
              <span>
                <ShieldCheck size={11} /> Toàn quyền
              </span>
            </span>
          </div>

          <button type="button" className="icon-button header-logout" onClick={() => leaveSession('')} aria-label="Đăng xuất">
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <main className="app-main">{renderView()}</main>

      <footer className="app-footer">
        <span>
          <Sparkles size={13} /> Tòa Án Tối Cao Ụm Bò Milk · Hệ thống kiểm soát &amp; xử lý vi phạm
        </span>
        <span>
          <Gavel size={13} /> Phiếu đã duyệt tự động lưu Drive &amp; cấn trừ KPI
        </span>
      </footer>
    </div>
  );
}
