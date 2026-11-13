import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  ChevronRight,
  Clock3,
  CloudUpload,
  Crown,
  Gavel,
  KeyRound,
  Landmark,
  Scale,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Users,
} from 'lucide-react';
import { ApiError, fetchOverview, fetchTickets } from '../services/api';
import type { ViolationAccount, ViolationOverview, ViolationTicket, ViewKey } from '../types';
import { compactMoney, formatDate, initials, money, monthLabel } from './ui';
import { useToast } from './toast';

interface Props {
  account: ViolationAccount;
  refreshKey: number;
  onNavigate: (view: ViewKey) => void;
}

interface TileConfig {
  key: ViewKey;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number | string }>;
  accent: string;
  badge?: string;
}

function greeting(): string {
  const hour = Number(
    new Date().toLocaleString('vi-VN', { hour: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).replace(/\D/g, ''),
  );
  if (hour < 11) return 'Chào buổi sáng';
  if (hour < 14) return 'Chào buổi trưa';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export function Dashboard({ account, refreshKey, onNavigate }: Props) {
  const toast = useToast();
  const [overview, setOverview] = useState<ViolationOverview | null>(null);
  const [tickets, setTickets] = useState<ViolationTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([fetchOverview(), fetchTickets()])
      .then(([nextOverview, nextTickets]) => {
        if (!alive) return;
        setOverview(nextOverview);
        setTickets(nextTickets);
      })
      .catch(error => {
        if (!alive) return;
        toast(error instanceof ApiError ? error.message : 'Không tải được tổng quan.', 'error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, toast]);

  const pending = useMemo(() => tickets.filter(ticket => ticket.status === 'PENDING'), [tickets]);
  const approved = useMemo(() => tickets.filter(ticket => ticket.status === 'APPROVED'), [tickets]);

  const tiles: TileConfig[] = [
    {
      key: 'regulations',
      title: 'Quy chế Công Ty',
      description: 'Tra cứu toàn bộ lỗi vi phạm và mức phạt đang áp dụng.',
      icon: BookOpenCheck,
      accent: '#e3b866',
      badge: overview ? `${overview.regulations_active} điều` : undefined,
    },
    {
      key: 'catch',
      title: 'Bắt Lỗi Vi Phạm',
      description: 'Chọn nhân viên, gắn lỗi và lập phiếu vi phạm mới.',
      icon: Gavel,
      accent: '#f2705b',
    },
    {
      key: 'pending',
      title: 'Lỗi Vi Phạm Chưa Duyệt',
      description: 'Kiểm tra, chỉnh sửa hoặc duyệt các phiếu đang chờ.',
      icon: Clock3,
      accent: '#f5b544',
      badge: overview ? `${overview.pending_count}` : undefined,
    },
    {
      key: 'approved',
      title: 'Lỗi Vi Phạm Đã Duyệt',
      description: 'Kho phiếu đã duyệt, PDF Drive và trạng thái TRỪ KPI.',
      icon: BadgeCheck,
      accent: '#51c99a',
      badge: overview ? `${overview.approved_count}` : undefined,
    },
    {
      key: 'adjust',
      title: 'Điều Chỉnh Quy Chế',
      description: 'Thêm, sửa, xóa quy chế và mức phạt — đồng bộ tức thời.',
      icon: Settings2,
      accent: '#65a9f3',
    },
    {
      key: 'change-pin',
      title: 'Đổi Mật Khẩu',
      description: 'Quản trị mã PIN 8 số và cấp lại mật khẩu khẩn cấp.',
      icon: KeyRound,
      accent: '#b48af7',
    },
    {
      key: 'profile',
      title: 'Thông Tin Cá Nhân',
      description: 'Toàn bộ thẩm quyền tối cao và dấu ấn phiên làm việc.',
      icon: Crown,
      accent: '#f08fb0',
    },
  ];

  const month = overview?.month || new Date().toISOString().slice(0, 7);

  return (
    <div className="dashboard">
      <section className="dashboard-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Landmark size={13} /> TÒA ÁN TỐI CAO · {account.display_name.toUpperCase()}
          </span>
          <h1>
            {greeting()}, <em>thẩm phán tối cao</em>.
          </h1>
          <p>
            Hôm nay là {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
            . Mọi thay đổi về quy chế, phiếu vi phạm và KPI đều được đồng bộ theo thời gian thực.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-gold" onClick={() => onNavigate('catch')}>
              <Gavel size={17} /> Bắt lỗi ngay
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onNavigate('pending')}>
              <Clock3 size={17} /> Xem phiếu chờ duyệt
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        <div className="hero-seal" aria-hidden="true">
          <div className="hero-seal-inner">
            <Scale size={44} />
            <span>THẨM QUYỀN</span>
            <strong>TOÀN PHẦN</strong>
          </div>
          <div className="hero-orbit hero-orbit-one" />
          <div className="hero-orbit hero-orbit-two" />
        </div>
      </section>

      <section className="stat-grid">
        <article className="stat-card stat-amber">
          <div className="stat-head">
            <span>Chờ duyệt</span>
            <Clock3 size={17} />
          </div>
          <strong>{overview?.pending_count ?? '—'}</strong>
          <div className="stat-foot">
            <span>{money(overview?.pending_amount || 0)}</span>
            <span className="stat-trend">cần xử lý</span>
          </div>
        </article>
        <article className="stat-card stat-emerald">
          <div className="stat-head">
            <span>Đã duyệt</span>
            <BadgeCheck size={17} />
          </div>
          <strong>{overview?.approved_count ?? '—'}</strong>
          <div className="stat-foot">
            <span>{money(overview?.approved_amount || 0)}</span>
            <span className="stat-trend">tổng phạt</span>
          </div>
        </article>
        <article className="stat-card stat-gold">
          <div className="stat-head">
            <span>{monthLabel(month)}</span>
            <TrendingDown size={17} />
          </div>
          <strong>{overview?.month_count ?? '—'}</strong>
          <div className="stat-foot">
            <span>{compactMoney(overview?.month_amount || 0)}</span>
            <span className="stat-trend">trừ KPI tháng</span>
          </div>
        </article>
        <article className="stat-card stat-sky">
          <div className="stat-head">
            <span>Quy chế hiệu lực</span>
            <BookOpenCheck size={17} />
          </div>
          <strong>
            {overview?.regulations_active ?? '—'}
            <small>/{overview?.regulations_total ?? '—'}</small>
          </strong>
          <div className="stat-foot">
            <span>
              <Users size={12} /> {overview?.employees_total ?? '—'} nhân viên
            </span>
            <span className="stat-trend">đang theo dõi</span>
          </div>
        </article>
      </section>

      {overview && overview.drive_error_count > 0 ? (
        <div className="alert alert-danger dashboard-alert">
          <CloudUpload size={18} />
          <span>
            Có <strong>{overview.drive_error_count}</strong> phiếu đã duyệt chưa lưu được lên Google Drive.
            Mở kho phiếu đã duyệt để kiểm tra và đồng bộ lại.
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate('approved')}>
            Xử lý ngay
          </button>
        </div>
      ) : null}

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              <Sparkles size={13} /> TRUNG TÂM ĐIỀU HÀNH
            </span>
            <h2>Chức năng tối cao</h2>
          </div>
          <span className="section-note">7 nghiệp vụ · một cú chạm</span>
        </div>

        <div className={`tile-grid ${loading ? 'is-loading' : ''}`}>
          {tiles.map((tile, index) => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.key}
                type="button"
                className="tile"
                style={{ ['--tile-accent' as any]: tile.accent, ['--tile-delay' as any]: `${index * 45}ms` }}
                onClick={() => onNavigate(tile.key)}
              >
                <div className="tile-top">
                  <span className="tile-icon">
                    <Icon size={22} />
                  </span>
                  {tile.badge ? <span className="tile-badge">{tile.badge}</span> : <span className="tile-index">0{index + 1}</span>}
                </div>
                <div className="tile-copy">
                  <strong>{tile.title}</strong>
                  <span>{tile.description}</span>
                </div>
                <div className="tile-foot">
                  <span>Mở chức năng</span>
                  <ArrowUpRight size={16} />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="recent-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">
                <Clock3 size={13} /> HÀNG CHỜ
              </span>
              <h3>Phiếu chờ duyệt gần đây</h3>
            </div>
            <button type="button" className="link-button" onClick={() => onNavigate('pending')}>
              Xem tất cả <ChevronRight size={14} />
            </button>
          </div>
          <div className="mini-list">
            {pending.slice(0, 4).map(ticket => (
              <button key={ticket.ticket_id} type="button" className="mini-row" onClick={() => onNavigate('pending')}>
                <span className="mini-avatar">{initials(ticket.employee_name)}</span>
                <span className="mini-copy">
                  <strong>{ticket.employee_name}</strong>
                  <span>
                    {ticket.branch_name} · {formatDate(ticket.violation_date)}
                  </span>
                </span>
                <span className="mini-amount">{money(ticket.total_amount)}</span>
                <ChevronRight size={15} />
              </button>
            ))}
            {!loading && pending.length === 0 ? (
              <div className="mini-empty">
                <ShieldCheck size={18} />
                <span>Không có phiếu nào đang chờ duyệt.</span>
              </div>
            ) : null}
            {loading && pending.length === 0 ? <div className="mini-skeleton" /> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">
                <BadgeCheck size={13} /> ĐÃ PHÁN QUYẾT
              </span>
              <h3>Phiếu đã duyệt gần đây</h3>
            </div>
            <button type="button" className="link-button" onClick={() => onNavigate('approved')}>
              Xem tất cả <ChevronRight size={14} />
            </button>
          </div>
          <div className="mini-list">
            {approved.slice(0, 4).map(ticket => (
              <button key={ticket.ticket_id} type="button" className="mini-row" onClick={() => onNavigate('approved')}>
                <span className="mini-avatar mini-avatar-green">{initials(ticket.employee_name)}</span>
                <span className="mini-copy">
                  <strong>{ticket.employee_name}</strong>
                  <span>
                    {formatDate(ticket.violation_date)} · {ticket.items.length} lỗi
                  </span>
                </span>
                <span className="mini-amount mini-amount-red">{money(ticket.total_amount)}</span>
                <ChevronRight size={15} />
              </button>
            ))}
            {!loading && approved.length === 0 ? (
              <div className="mini-empty">
                <CalendarDays size={18} />
                <span>Chưa có phiếu vi phạm nào được duyệt.</span>
              </div>
            ) : null}
            {loading && approved.length === 0 ? <div className="mini-skeleton" /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
