import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  CloudUpload,
  ExternalLink,
  Eye,
  FileText,
  Gavel,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import {
  ApiError,
  approveTicket,
  deleteTicket,
  fetchTickets,
  syncTicketDrive,
} from '../services/api';
import type { ViolationTicket } from '../types';
import {
  ConfirmDialog,
  EmptyState,
  Modal,
  Spinner,
  ViewHeader,
  formatDate,
  formatDateTime,
  initials,
  money,
  monthLabel,
} from './ui';
import { useToast } from './toast';

interface Props {
  status: 'PENDING' | 'APPROVED';
  refreshKey: number;
}

function StatusBadge({ status }: { status: ViolationTicket['status'] }) {
  return status === 'APPROVED' ? (
    <span className="pill pill-green">
      <BadgeCheck size={12} /> Đã duyệt
    </span>
  ) : (
    <span className="pill pill-amber">
      <Clock3 size={12} /> Chưa duyệt
    </span>
  );
}

function DriveBadge({ ticket }: { ticket: ViolationTicket }) {
  const status = ticket.drive_sync_status;
  if (status === 'SYNCED') {
    return (
      <span className="pill pill-green">
        <CloudUpload size={12} /> Drive đã lưu
      </span>
    );
  }
  if (status === 'ERROR') {
    return (
      <span className="pill pill-red" title={ticket.drive_sync_error || undefined}>
        <CloudUpload size={12} /> Drive lỗi
      </span>
    );
  }
  if (status === 'NOT_CONFIGURED') {
    return (
      <span className="pill pill-muted">
        <CloudUpload size={12} /> Drive chưa cấu hình
      </span>
    );
  }
  return (
    <span className="pill pill-blue">
      <CloudUpload size={12} /> Chờ lưu Drive
    </span>
  );
}

export function TicketsView({ status, refreshKey }: Props) {
  const toast = useToast();
  const [tickets, setTickets] = useState<ViolationTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('');
  const [branch, setBranch] = useState('ALL');
  const [detailId, setDetailId] = useState('');
  const [approveId, setApproveId] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [busyId, setBusyId] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchTickets(status)
      .then(items => {
        if (alive) setTickets(items);
      })
      .catch(error => {
        if (alive) toast(error instanceof ApiError ? error.message : 'Không tải được danh sách phiếu.', 'error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [status, refreshKey, version, toast]);

  const branches = useMemo(() => {
    const map = new Map<string, string>();
    tickets.forEach(ticket => map.set(ticket.branch_id, ticket.branch_name));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  }, [tickets]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return tickets.filter(ticket => {
      if (period && ticket.period !== period) return false;
      if (branch !== 'ALL' && ticket.branch_id !== branch) return false;
      if (!keyword) return true;
      return `${ticket.employee_name} ${ticket.employee_code || ''} ${ticket.ticket_code} ${ticket.branch_name}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [tickets, search, period, branch]);

  const totalAmount = filtered.reduce((sum, ticket) => sum + (ticket.total_amount || 0), 0);
  const detail = tickets.find(ticket => ticket.ticket_id === detailId) || null;

  const replaceTicket = (next: ViolationTicket) => {
    setTickets(current => {
      if (next.status !== status) return current.filter(ticket => ticket.ticket_id !== next.ticket_id);
      return current.map(ticket => (ticket.ticket_id === next.ticket_id ? next : ticket));
    });
  };

  const doApprove = async () => {
    if (!approveId) return;
    setBusyId(approveId);
    try {
      const ticket = await approveTicket(approveId);
      toast(
        ticket.drive_sync_status === 'SYNCED'
          ? `Đã duyệt phiếu ${ticket.ticket_code}. PDF và TRỪ KPI đã đồng bộ.`
          : `Đã duyệt phiếu ${ticket.ticket_code} và cập nhật TRỪ KPI. Drive: ${
              ticket.drive_sync_status === 'NOT_CONFIGURED' ? 'chưa cấu hình' : ticket.drive_sync_error || 'chưa lưu được'
            }.`,
        ticket.drive_sync_status === 'SYNCED' ? 'success' : 'info',
      );
      replaceTicket(ticket);
      setDetailId('');
      setApproveId('');
      setVersion(value => value + 1);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Không thể duyệt phiếu.', 'error');
    } finally {
      setBusyId('');
    }
  };

  const doDelete = async () => {
    if (!deleteId) return;
    setBusyId(deleteId);
    try {
      await deleteTicket(deleteId);
      setTickets(current => current.filter(ticket => ticket.ticket_id !== deleteId));
      toast('Đã xóa phiếu vi phạm.', 'success');
      if (detailId === deleteId) setDetailId('');
      setDeleteId('');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Không thể xóa phiếu.', 'error');
    } finally {
      setBusyId('');
    }
  };

  const doSync = async (ticket: ViolationTicket) => {
    setBusyId(ticket.ticket_id);
    try {
      const next = await syncTicketDrive(ticket.ticket_id);
      replaceTicket(next);
      if (next.drive_sync_status === 'SYNCED') {
        toast(`Đã lưu PDF phiếu ${next.ticket_code} lên Google Drive.`, 'success');
      } else {
        toast(
          `Chưa thể lưu Drive: ${
            next.drive_sync_status === 'NOT_CONFIGURED' ? 'chưa cấu hình Drive trên máy chủ' : next.drive_sync_error || 'lỗi không xác định'
          }.`,
          'error',
        );
      }
      setVersion(value => value + 1);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Không thể đồng bộ Drive.', 'error');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="view">
      <ViewHeader
        eyebrow={
          status === 'PENDING' ? (
            <>
              <Clock3 size={13} /> LỖI VI PHẠM CHƯA DUYỆT
            </>
          ) : (
            <>
              <BadgeCheck size={13} /> LỖI VI PHẠM ĐÃ DUYỆT
            </>
          )
        }
        title={status === 'PENDING' ? 'Phiếu đang chờ phán quyết' : 'Kho phiếu đã duyệt'}
        description={
          status === 'PENDING'
            ? 'Các phiếu lưu tạm hoặc chờ kiểm tra. Duyệt phiếu sẽ kích hoạt lưu Drive và cấn trừ KPI ngay lập tức.'
            : 'Toàn bộ phiếu đã duyệt, kèm trạng thái lưu PDF Drive và đồng bộ TRỪ KPI.'
        }
        actions={
          <div className="header-metric">
            <span>{filtered.length} phiếu</span>
            <strong className={status === 'APPROVED' ? 'text-red' : ''}>{money(totalAmount)}</strong>
          </div>
        }
      />

      <div className="toolbar">
        <label className="search-box">
          <Search size={16} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Tìm nhân viên, mã phiếu, chi nhánh..."
          />
          {search ? (
            <button type="button" onClick={() => setSearch('')} aria-label="Xóa tìm kiếm">
              <X size={14} />
            </button>
          ) : null}
        </label>
        <div className="toolbar-right">
          <label className="select-wrap">
            <select value={branch} onChange={event => setBranch(event.target.value)}>
              <option value="ALL">Tất cả chi nhánh</option>
              {branches.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="month-wrap">
            <CalendarDays size={15} />
            <input type="month" value={period} onChange={event => setPeriod(event.target.value)} />
            {period ? (
              <button type="button" onClick={() => setPeriod('')} aria-label="Bỏ lọc tháng">
                <X size={13} />
              </button>
            ) : null}
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVersion(value => value + 1)}>
            <RefreshCw size={14} /> Làm mới
          </button>
        </div>
      </div>

      {loading ? <Spinner label="Đang tải phiếu vi phạm..." /> : null}

      {!loading && filtered.length === 0 ? (
        <EmptyState
          icon={status === 'PENDING' ? <Clock3 size={22} /> : <BadgeCheck size={22} />}
          title={status === 'PENDING' ? 'Không có phiếu chờ duyệt' : 'Chưa có phiếu nào được duyệt'}
          description={
            status === 'PENDING'
              ? 'Mọi phiếu đã được xử lý hoặc chưa có phiếu nào được lưu tạm.'
              : 'Duyệt phiếu từ màn hình Bắt lỗi vi phạm hoặc khu vực Chưa duyệt để bắt đầu kho lưu trữ.'
          }
        />
      ) : null}

      <div className="ticket-grid">
        {filtered.map(ticket => (
          <article key={ticket.ticket_id} className={`ticket-card ${ticket.status === 'APPROVED' ? 'is-approved' : ''}`}>
            <div className="ticket-head">
              <span className="mini-avatar">{initials(ticket.employee_name)}</span>
              <div className="ticket-identity">
                <strong>{ticket.employee_name}</strong>
                <span>
                  <Building2 size={12} /> {ticket.branch_name}
                </span>
              </div>
              <StatusBadge status={ticket.status} />
            </div>

            <div className="ticket-code-line">
              <span className="ticket-code">{ticket.ticket_code}</span>
              <span>{monthLabel(ticket.period)}</span>
            </div>

            <div className="ticket-items-preview">
              {ticket.items.slice(0, 3).map((item, index) => (
                <span key={`${ticket.ticket_id}-${index}`} className="item-chip">
                  {item.name}
                </span>
              ))}
              {ticket.items.length > 3 ? <span className="item-chip item-chip-more">+{ticket.items.length - 3}</span> : null}
            </div>

            <div className="ticket-meta">
              <span>
                <CalendarDays size={13} /> {formatDate(ticket.violation_date)}
              </span>
              <span>
                <Gavel size={13} /> {ticket.items.length} lỗi
              </span>
            </div>

            <div className="ticket-total">
              <span>
                <Wallet size={14} /> Tổng phạt
              </span>
              <strong>{money(ticket.total_amount)}</strong>
            </div>

            {ticket.status === 'APPROVED' ? (
              <div className="ticket-badges">
                <DriveBadge ticket={ticket} />
                {ticket.payroll_applied_at ? (
                  <span className="pill pill-green">
                    <Check size={12} /> Đã trừ KPI
                  </span>
                ) : (
                  <span className="pill pill-muted">Chưa ghi KPI</span>
                )}
              </div>
            ) : null}

            <div className="ticket-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetailId(ticket.ticket_id)}>
                <Eye size={15} /> Chi tiết
              </button>
              {ticket.status === 'PENDING' ? (
                <>
                  <button type="button" className="btn btn-ghost btn-sm btn-danger-ghost" onClick={() => setDeleteId(ticket.ticket_id)}>
                    <Trash2 size={15} />
                  </button>
                  <button type="button" className="btn btn-gold btn-sm" onClick={() => setApproveId(ticket.ticket_id)}>
                    <Gavel size={15} /> Duyệt
                  </button>
                </>
              ) : (
                <>
                  {ticket.drive_view_url ? (
                    <a className="btn btn-ghost btn-sm" href={ticket.drive_view_url} target="_blank" rel="noreferrer">
                      <ExternalLink size={15} /> PDF
                    </a>
                  ) : null}
                  {ticket.drive_sync_status !== 'SYNCED' ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void doSync(ticket)}
                      disabled={busyId === ticket.ticket_id}
                    >
                      {busyId === ticket.ticket_id ? <Loader2 size={15} className="spin" /> : <CloudUpload size={15} />}
                      Đồng bộ Drive
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      <Modal
        open={!!detail}
        onClose={() => setDetailId('')}
        title={detail ? `Phiếu ${detail.ticket_code}` : 'Chi tiết phiếu'}
        subtitle={detail ? `${detail.employee_name} · ${detail.branch_name}` : undefined}
        size="lg"
        footer={
          detail ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setDetailId('')}>
                Đóng
              </button>
              {detail.status === 'PENDING' ? (
                <button type="button" className="btn btn-gold" onClick={() => setApproveId(detail.ticket_id)}>
                  <Gavel size={16} /> Duyệt phiếu
                </button>
              ) : detail.drive_sync_status !== 'SYNCED' ? (
                <button
                  type="button"
                  className="btn btn-gold"
                  onClick={() => void doSync(detail)}
                  disabled={busyId === detail.ticket_id}
                >
                  {busyId === detail.ticket_id ? <Loader2 size={16} className="spin" /> : <CloudUpload size={16} />}
                  Đồng bộ Drive
                </button>
              ) : null}
            </>
          ) : null
        }
      >
        {detail ? (
          <div className="ticket-detail">
            <div className="detail-top">
              <span className="mini-avatar mini-avatar-lg">{initials(detail.employee_name)}</span>
              <div className="detail-identity">
                <strong>{detail.employee_name}</strong>
                <span>
                  Mã {detail.employee_code || detail.employee_id} · {detail.branch_name}
                </span>
              </div>
              <div className="detail-badges">
                <StatusBadge status={detail.status} />
                {detail.status === 'APPROVED' ? <DriveBadge ticket={detail} /> : null}
              </div>
            </div>

            <div className="detail-grid">
              <div>
                <span>Ngày vi phạm</span>
                <strong>{formatDate(detail.violation_date)}</strong>
              </div>
              <div>
                <span>Kỳ ghi nhận</span>
                <strong>{monthLabel(detail.period)}</strong>
              </div>
              <div>
                <span>Người lập</span>
                <strong>{detail.created_by_name || detail.created_by}</strong>
              </div>
              <div>
                <span>Thời điểm lập</span>
                <strong>{formatDateTime(detail.created_at)}</strong>
              </div>
              {detail.approved_at ? (
                <>
                  <div>
                    <span>Người duyệt</span>
                    <strong>{detail.approved_by_name || detail.approved_by || '—'}</strong>
                  </div>
                  <div>
                    <span>Thời điểm duyệt</span>
                    <strong>{formatDateTime(detail.approved_at)}</strong>
                  </div>
                </>
              ) : null}
            </div>

            <div className="detail-section">
              <h4>
                <FileText size={15} /> Danh sách lỗi vi phạm
              </h4>
              <div className="detail-items">
                {detail.items.map((item, index) => (
                  <div key={`${item.regulation_id}-${index}`} className="detail-item">
                    <span className="item-index">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.category}
                        {item.fine_note ? ` · ${item.fine_note}` : ''}
                      </span>
                    </div>
                    <strong>{item.fine_amount > 0 ? money(item.fine_amount) : (item.fine_note || money(0))}</strong>
                  </div>
                ))}
              </div>
              <div className="detail-total">
                <span>Tổng mức phạt</span>
                <strong>{money(detail.total_amount)}</strong>
              </div>
            </div>

            {detail.note ? (
              <div className="detail-section">
                <h4>Ghi chú</h4>
                <p className="detail-note">{detail.note}</p>
              </div>
            ) : null}

            {detail.status === 'APPROVED' ? (
              <div className="detail-sync-grid">
                <div className="sync-card">
                  <div className="sync-head">
                    <CloudUpload size={16} />
                    <strong>Google Drive</strong>
                    <DriveBadge ticket={detail} />
                  </div>
                  <span>Lưu lúc: {formatDateTime(detail.drive_synced_at)}</span>
                  {detail.drive_sync_error ? <span className="sync-error">Lỗi: {detail.drive_sync_error}</span> : null}
                  {detail.drive_view_url ? (
                    <a href={detail.drive_view_url} target="_blank" rel="noreferrer" className="link-button">
                      Mở PDF trên Drive <ExternalLink size={13} />
                    </a>
                  ) : null}
                </div>
                <div className="sync-card">
                  <div className="sync-head">
                    <Wallet size={16} />
                    <strong>TRỪ KPI</strong>
                    {detail.payroll_applied_at ? <span className="pill pill-green">Đã ghi</span> : <span className="pill pill-muted">Chưa ghi</span>}
                  </div>
                  <span>Số tiền: {money(detail.payroll_applied_amount ?? detail.total_amount)}</span>
                  <span>Kỳ lương: {monthLabel(detail.payroll_period || detail.period)}</span>
                  <span>Ghi lúc: {formatDateTime(detail.payroll_applied_at)}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!approveId}
        title="Duyệt phiếu vi phạm?"
        message={
          <>
            Phiếu sẽ được chuyển sang trạng thái <strong>Đã duyệt</strong>. Hệ thống lưu PDF lên Google Drive và cộng
            tổng phạt vào <strong>TRỪ KPI</strong> của kỳ tương ứng. Thao tác không thể hoàn tác.
          </>
        }
        confirmLabel="Duyệt phiếu"
        busy={busyId === approveId}
        onConfirm={() => void doApprove()}
        onCancel={() => setApproveId('')}
      />

      <ConfirmDialog
        open={!!deleteId}
        title="Xóa phiếu vi phạm?"
        message="Phiếu đang chờ duyệt sẽ bị xóa vĩnh viễn khỏi hệ thống."
        confirmLabel="Xóa phiếu"
        tone="danger"
        busy={busyId === deleteId}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteId('')}
      />
    </div>
  );
}
