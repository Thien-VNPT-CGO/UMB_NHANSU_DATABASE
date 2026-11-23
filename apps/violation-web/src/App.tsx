import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  ChevronRight,
  Clock3,
  Gavel,
  Landmark,
  LayoutDashboard,
  Loader2,
  LogOut,
  ShieldCheck,
  UserRound,
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
import { AccountView } from './components/AccountView';
import { initials } from './components/ui';

const VIEW_LABELS: Record<ViewKey, string> = {
  dashboard: 'Trung tâm điều hành',
  regulations: 'Quy chế Công ty',
  catch: 'Bắt lỗi vi phạm',
  pending: 'Phiếu chờ duyệt',
  approved: 'Phiếu đã duyệt',
  account: 'Tài khoản & bảo mật',
};

const REALTIME_LABEL: Record<RealtimeStatus, string> = {
  connecting: 'Đang kết nối',
  online: 'Trực tuyến',
  offline: 'Ngoại tuyến',
};

const VIEW_KEYS = Object.keys(VIEW_LABELS) as ViewKey[];

/** Hỗ trợ deep-link dạng #quy-che để mở thẳng một màn hình khi tải trang. */
const VIEW_ALIASES: Record<string, ViewKey> = {
  dashboard: 'dashboard',
  'tong-quan': 'dashboard',
  regulations: 'regulations',
  'quy-che': 'regulations',
  catch: 'catch',
  'bat-loi': 'catch',
  pending: 'pending',
  'cho-duyet': 'pending',
  approved: 'approved',
  'da-duyet': 'approved',
  account: 'account',
  'tai-khoan': 'account',
};

function viewFromHash(): ViewKey {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (!raw) return 'dashboard';
  if (VIEW_ALIASES[raw]) return VIEW_ALIASES[raw];
  return VIEW_KEYS.includes(raw as ViewKey) ? (raw as ViewKey) : 'dashboard';
}

interface NavItem {
  key: ViewKey;
  label: string;
  hint: string;
  icon: React.ComponentType<{ size?: number | string }>;
}

const MAIN_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Tổng quan', hint: 'Bảng điều khiển', icon: LayoutDashboard },
  { key: 'catch', label: 'Bắt lỗi', hint: 'Lập phiếu vi phạm', icon: Gavel },
  { key: 'pending', label: 'Chờ duyệt', hint: 'Phiếu cần xử lý', icon: Clock3 },
  { key: 'approved', label: 'Đã duyệt', hint: 'Kho phiếu & KPI', icon: BadgeCheck },
  { key: 'regulations', label: 'Quy chế', hint: 'Bộ luật công ty', icon: BookOpenCheck },
];

const MOBILE_NAV: NavItem[] = [MAIN_NAV[0], MAIN_NAV[1], MAIN_NAV[2], MAIN_NAV[3], { key: 'account', label: 'Tài khoản', hint: 'Hồ sơ & PIN', icon: UserRound }];

export function App() {
  const [booting, setBooting] = useState(true);
  const [account, setAccount] = useState<ViolationAccount | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [knownPin, setKnownPin] = useState('');
  const [view, setView] = useState<ViewKey>(() => viewFromHash());
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
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      /* bỏ qua */
    }
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
    setView(result.account.role === 'ADMIN' ? 'dashboard' : 'catch');
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      /* bỏ qua */
    }
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

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const label = account && !mustChange ? VIEW_LABELS[view] : 'Đăng nhập';
    document.title = `${label} · Tòa Án Tối Cao Ụm Bò Milk`;
  }, [view, account, mustChange]);

  const navigate = (next: ViewKey) => {
    if (viewFromHash() === next) {
      setView(next);
    } else {
      window.location.hash = next;
    }
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  };

  const handleSaved = (status: 'PENDING' | 'APPROVED') => {
    bumpRefresh();
    if (account?.role !== 'ADMIN') {
      // Nhân viên chỉ có màn lập phiếu: ở lại trang này để lập tiếp.
      setView('catch');
      return;
    }
    navigate(status === 'PENDING' ? 'pending' : 'approved');
  };

  const isAdmin = account?.role === 'ADMIN';
  const allowedViews = useMemo<ViewKey[]>(
    () => (isAdmin ? VIEW_KEYS : ['catch', 'account']),
    [isAdmin],
  );
  const navItems = useMemo(
    () => (isAdmin ? MAIN_NAV : MAIN_NAV.filter(item => item.key === 'catch')),
    [isAdmin],
  );
  const mobileItems = useMemo(
    () =>
      isAdmin
        ? MOBILE_NAV
        : [
            MAIN_NAV[1],
            { key: 'account' as ViewKey, label: 'Tài khoản', hint: 'Hồ sơ & PIN', icon: UserRound },
          ],
    [isAdmin],
  );

  // Chặn deep-link/hash tới màn hình ngoài quyền của tài khoản nhân viên.
  useEffect(() => {
    if (!account || mustChange) return;
    if (!allowedViews.includes(view)) {
      setView(allowedViews[0]);
      try {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${allowedViews[0]}`);
      } catch {
        /* bỏ qua */
      }
    }
  }, [account, mustChange, view, allowedViews]);

  const currentLabel = useMemo(() => VIEW_LABELS[view], [view]);

  if (booting) {
    return (
      <div className="splash-screen">
        <div className="splash-seal">
          <Landmark size={34} />
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
    if (!isAdmin) {
      if (view === 'account') {
        return (
          <AccountView
            account={account}
            knownPin={knownPin}
            onChanged={handlePinChanged}
            onReset={handlePinReset}
            onLogout={() => leaveSession('')}
          />
        );
      }
      return <CatchViolationView refreshKey={refreshKey} onSaved={handleSaved} canApprove={false} />;
    }
    switch (view) {
      case 'regulations':
        return <RegulationsView refreshKey={refreshKey} />;
      case 'catch':
        return <CatchViolationView refreshKey={refreshKey} onSaved={handleSaved} canApprove />;
      case 'pending':
        return <TicketsView status="PENDING" refreshKey={refreshKey} canManage />;
      case 'approved':
        return <TicketsView status="APPROVED" refreshKey={refreshKey} canManage />;
      case 'account':
        return (
          <AccountView
            account={account}
            knownPin={knownPin}
            onChanged={handlePinChanged}
            onReset={handlePinReset}
            onLogout={() => leaveSession('')}
          />
        );
      default:
        return <Dashboard refreshKey={refreshKey} onNavigate={navigate} />;
    }
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <button type="button" className="sidebar-brand" onClick={() => navigate('dashboard')} aria-label="Về trang tổng quan">
          <span className="brand-mark">
            <Landmark size={20} />
          </span>
          <span className="brand-lines">
            <strong>Tòa Án Tối Cao</strong>
            <span>Ụm Bò Milk</span>
          </span>
        </button>

        <nav className="side-nav" aria-label="Điều hướng chính">
          <span className="side-nav-label">{isAdmin ? 'Điều hành' : 'Lập phiếu'}</span>
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={`side-link ${view === item.key ? 'is-active' : ''}`}
                onClick={() => navigate(item.key)}
                aria-current={view === item.key ? 'page' : undefined}
              >
                <span className="side-link-icon">
                  <Icon size={18} />
                </span>
                <span className="side-link-copy">
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </span>
              </button>
            );
          })}
          <span className="side-nav-label">Cá nhân</span>
          <button
            type="button"
            className={`side-link ${view === 'account' ? 'is-active' : ''}`}
            onClick={() => navigate('account')}
            aria-current={view === 'account' ? 'page' : undefined}
          >
            <span className="side-link-icon">
              <UserRound size={18} />
            </span>
            <span className="side-link-copy">
              <strong>Tài khoản</strong>
              <span>Hồ sơ &amp; mã PIN</span>
            </span>
          </button>
        </nav>

        <div className="side-foot">
          <a className="side-exit" href="/">
            <ArrowLeft size={15} /> Về hệ thống nhân sự
          </a>
        </div>
      </aside>

      <div className="app-main-wrap">
        <header className="app-topbar">
          <div className="topbar-crumb">
            <span className="topbar-brand-mobile">
              <span className="brand-mark brand-mark-sm">
                <Landmark size={16} />
              </span>
              <strong>Tòa Án Ụm Bò Milk</strong>
            </span>
            <span className="topbar-path">
              <ShieldCheck size={14} />
              <span>Quản trị vi phạm</span>
              <ChevronRight size={13} />
              <strong>{currentLabel}</strong>
            </span>
          </div>

          <div className="topbar-right">
            <span className={`realtime-pill realtime-${realtime} topbar-realtime`}>
              {realtime === 'online' ? <Wifi size={13} /> : <WifiOff size={13} />}
              {REALTIME_LABEL[realtime]}
            </span>

            <button type="button" className="topbar-account" onClick={() => navigate('account')}>
              <span className="mini-avatar">{initials(account.display_name)}</span>
              <span className="topbar-account-copy">
                <strong>{account.display_name}</strong>
                <span>{isAdmin ? 'Toàn quyền hệ thống' : 'Nhân viên lập phiếu'}</span>
              </span>
            </button>

            <button type="button" className="icon-button" onClick={() => leaveSession('')} aria-label="Đăng xuất" title="Đăng xuất">
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <main className="app-main">{renderView()}</main>
      </div>

      <nav className="mobile-nav" aria-label="Điều hướng nhanh">
        {mobileItems.map(item => {
          const Icon = item.icon;
          const active = view === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`mobile-nav-item ${active ? 'is-active' : ''}`}
              onClick={() => navigate(item.key)}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
