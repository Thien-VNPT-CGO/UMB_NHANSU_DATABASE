import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  ChevronRight,
  Clock3,
  CloudUpload,
  Gavel,
  Landmark,
  Scale,
  ShieldCheck,
  TrendingDown,
  Users,
} from 'lucide-react';
import { ApiError, fetchOverview, fetchTickets } from '../services/api';
import type { ViolationOverview, ViolationTicket, ViewKey } from '../types';
import { compactMoney, currentPeriod, formatDate, initials, money, monthLabel } from './ui';
import { useToast } from './toast';

interface Props {
  refreshKey: number;
  onNavigate: (view: ViewKey) => void;
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

export function Dashboard({ refreshKey, onNavigate }: Props) {
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

  const month = overview?.month || currentPeriod();

  return (
    <div className="dashboard">
      <section className="dashboard-intro">
        <div className="intro-copy">
          <span className="eyebrow">
            <Landmark size={13} /> TÒA ÁN TỐI CAO · ỤM BÒ MILK
          </span>
          <h1>
            {greeting()}, <em>thẩm phán tối cao</em>.
          </h1>
          <p>
            Hôm nay là{' '}
            {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}.
            Mọi thay đổi về quy chế, phiếu vi phạm và KPI đều được đồng bộ theo thời gian thực.
          </p>
          <div className="intro-actions">
            <button type="button" className="btn btn-gold" onClick={() => onNavigate('catch')}>
              <Gavel size={17} /> Bắt lỗi ngay
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onNavigate('regulations')}>
              <BookOpenCheck size={17} /> Xem quy chế
            </button>
          </div>
        </div>
        <div className="intro-summary">
          <span className="intro-summary-icon">
            <Scale size={30} />
          </span>
          <div>
            <strong>{overview?.pending_count ?? '—'}</strong>
            <span>phiếu đang chờ phán quyết</span>
          </div>
          <button type="button" className="intro-summary-link" onClick={() => onNavigate('pending')}>
            Xử lý ngay <ArrowRight size={14} />
          </button>
        </div>
      </section>

      <section className="stat-grid">
        <button type="button" className="stat-card stat-amber" onClick={() => onNavigate('pending')}>
          <div className="stat-head">
            <span>Chờ duyệt</span>
            <Clock3 size={17} />
          </div>
          <strong>{overview?.pending_count ?? '—'}</strong>
          <div className="stat-foot">
            <span>{money(overview?.pending_amount || 0)}</span>
            <span className="stat-trend">cần xử lý</span>
          </div>
        </button>
        <button type="button" className="stat-card stat-emerald" onClick={() => onNavigate('approved')}>
          <div className="stat-head">
            <span>Đã duyệt</span>
            <BadgeCheck size={17} />
          </div>
          <strong>{overview?.approved_count ?? '—'}</strong>
          <div className="stat-foot">
            <span>{money(overview?.approved_amount || 0)}</span>
            <span className="stat-trend">tổng phạt</span>
          </div>
        </button>
        <button type="button" className="stat-card stat-gold" onClick={() => onNavigate('approved')}>
          <div className="stat-head">
            <span>{monthLabel(month)}</span>
            <TrendingDown size={17} />
          </div>
          <strong>{overview?.month_count ?? '—'}</strong>
          <div className="stat-foot">
            <span>{compactMoney(overview?.month_amount || 0)}</span>
            <span className="stat-trend">trừ KPI tháng</span>
          </div>
        </button>
        <button type="button" className="stat-card stat-sky" onClick={() => onNavigate('regulations')}>
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
        </button>
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
