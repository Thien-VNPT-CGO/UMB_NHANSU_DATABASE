import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronRight,
  CirclePlus,
  Gavel,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { ApiError, createTicket, fetchEmployees, fetchRegulations } from '../services/api';
import type { Regulation, TicketItem, TicketStatus, ViolationEmployee } from '../types';
import {
  ConfirmDialog,
  EmptyState,
  Modal,
  SearchBox,
  Spinner,
  ViewHeader,
  initials,
  money,
  todayIso,
} from './ui';
import { useToast } from './toast';

interface Props {
  refreshKey: number;
  onSaved: (status: TicketStatus) => void;
}

export function CatchViolationView({ refreshKey, onSaved }: Props) {
  const toast = useToast();
  const [employees, setEmployees] = useState<ViolationEmployee[]>([]);
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [violationDate, setViolationDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [items, setItems] = useState<TicketItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCategory, setPickerCategory] = useState('ALL');
  const [saving, setSaving] = useState<TicketStatus | null>(null);
  const [askApprove, setAskApprove] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([fetchEmployees(), fetchRegulations()])
      .then(([nextEmployees, nextRegulations]) => {
        if (!alive) return;
        setEmployees(nextEmployees);
        setRegulations(nextRegulations);
      })
      .catch(error => {
        if (alive) toast(error instanceof ApiError ? error.message : 'Không tải được dữ liệu.', 'error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, toast]);

  const branches = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach(employee => map.set(employee.branch_id, employee.branch_name));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const keyword = employeeSearch.trim().toLowerCase();
    return employees.filter(employee => {
      if (branchFilter !== 'ALL' && employee.branch_id !== branchFilter) return false;
      if (!keyword) return true;
      return `${employee.full_name} ${employee.employee_code} ${employee.branch_name}`.toLowerCase().includes(keyword);
    });
  }, [employees, employeeSearch, branchFilter]);

  const selectedEmployee = employees.find(employee => employee.employee_id === selectedEmployeeId) || null;
  const total = items.reduce((sum, item) => sum + (Number(item.fine_amount) || 0), 0);

  const pickerCategories = useMemo(
    () => Array.from(new Set(regulations.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi')),
    [regulations],
  );

  const pickerResults = useMemo(() => {
    const keyword = pickerSearch.trim().toLowerCase();
    return regulations
      .filter(item => item.active !== false)
      .filter(item => pickerCategory === 'ALL' || item.category === pickerCategory)
      .filter(item => !keyword || `${item.code} ${item.name} ${item.category}`.toLowerCase().includes(keyword));
  }, [regulations, pickerSearch, pickerCategory]);

  const addRegulation = (regulation: Regulation) => {
    setItems(current => {
      if (current.some(item => item.regulation_id === regulation.regulation_id)) return current;
      return [
        ...current,
        {
          regulation_id: regulation.regulation_id,
          name: regulation.name,
          category: regulation.category,
          fine_amount: regulation.fine_amount,
          fine_note: regulation.fine_note,
        },
      ];
    });
  };

  const updateFine = (regulationId: string, value: string) => {
    const digits = value.replace(/[^\d]/g, '');
    setItems(current =>
      current.map(item =>
        item.regulation_id === regulationId ? { ...item, fine_amount: Number(digits || 0) } : item,
      ),
    );
  };

  const removeItem = (regulationId: string) => {
    setItems(current => current.filter(item => item.regulation_id !== regulationId));
  };

  const resetComposer = () => {
    setItems([]);
    setNote('');
    setViolationDate(todayIso());
    setPickerSearch('');
    setPickerCategory('ALL');
  };

  const save = async (status: TicketStatus) => {
    if (saving) return;
    if (!selectedEmployee) {
      toast('Vui lòng chọn nhân viên vi phạm.', 'error');
      return;
    }
    if (items.length === 0) {
      toast('Vui lòng thêm ít nhất 1 lỗi vi phạm.', 'error');
      return;
    }
    setSaving(status);
    try {
      const ticket = await createTicket({
        employee_id: selectedEmployee.employee_id,
        violation_date: violationDate,
        note: note.trim() || undefined,
        status,
        items,
      });
      if (status === 'APPROVED') {
        if (ticket.drive_sync_status === 'SYNCED') {
          toast(`Đã duyệt phiếu ${ticket.ticket_code}. PDF đã lưu lên Drive và TRỪ KPI đã cập nhật.`, 'success');
        } else if (ticket.drive_sync_status === 'NOT_CONFIGURED') {
          toast(`Đã duyệt phiếu ${ticket.ticket_code} và cập nhật TRỪ KPI. Drive chưa được cấu hình.`, 'info');
        } else {
          toast(
            `Đã duyệt phiếu ${ticket.ticket_code} và cập nhật TRỪ KPI. Drive chưa lưu được: ${ticket.drive_sync_error || 'lỗi không xác định'}.`,
            'info',
          );
        }
      } else {
        toast(`Đã lưu tạm phiếu ${ticket.ticket_code} vào khu vực Chưa duyệt.`, 'success');
      }
      resetComposer();
      onSaved(status);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Không thể lưu phiếu vi phạm.', 'error');
    } finally {
      setSaving(null);
      setAskApprove(false);
    }
  };

  return (
    <div className="view">
      <ViewHeader
        eyebrow={
          <>
            <Gavel size={13} /> BẮT LỖI VI PHẠM
          </>
        }
        title="Lập phiếu vi phạm"
        description="Chọn nhân viên, gắn các lỗi vi phạm và điều chỉnh mức phạt. Lưu tạm để rà soát hoặc duyệt ngay để cập nhật Drive và TRỪ KPI."
      />

      {loading ? <Spinner label="Đang tải nhân viên và quy chế..." /> : null}

      <div className="catch-layout">
        <section className="panel employee-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">
                <Users size={13} /> BƯỚC 1
              </span>
              <h3>Chọn nhân viên</h3>
            </div>
            <span className="count-chip">{filteredEmployees.length}</span>
          </div>

          <div className="employee-filters">
            <SearchBox value={employeeSearch} onChange={setEmployeeSearch} placeholder="Tìm tên hoặc mã nhân viên..." />
            <label className="select-wrap select-full">
              <select value={branchFilter} onChange={event => setBranchFilter(event.target.value)}>
                <option value="ALL">Tất cả chi nhánh</option>
                {branches.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="employee-list">
            {filteredEmployees.map(employee => {
              const selected = employee.employee_id === selectedEmployeeId;
              return (
                <button
                  key={employee.employee_id}
                  type="button"
                  className={`employee-row ${selected ? 'is-selected' : ''}`}
                  onClick={() => setSelectedEmployeeId(employee.employee_id)}
                >
                  <span className="mini-avatar">{initials(employee.full_name)}</span>
                  <span className="employee-copy">
                    <strong>{employee.full_name}</strong>
                    <span>{employee.branch_name}</span>
                  </span>
                  <span className="employee-code">{employee.employee_code || '—'}</span>
                  {selected ? <Check size={16} className="employee-check" /> : <ChevronRight size={15} />}
                </button>
              );
            })}
            {!loading && filteredEmployees.length === 0 ? (
              <EmptyState icon={<Users size={20} />} title="Không tìm thấy nhân viên" description="Thử đổi từ khóa hoặc chi nhánh." />
            ) : null}
          </div>
        </section>

        <section className="composer">
          {!selectedEmployee ? (
            <div className="panel composer-empty">
              <EmptyState
                icon={<UserRound size={24} />}
                title="Chưa chọn nhân viên"
                description="Chọn một nhân viên ở danh sách bên trái để bắt đầu lập phiếu vi phạm."
              />
            </div>
          ) : (
            <>
              <div className="panel selected-employee-card">
                <span className="mini-avatar mini-avatar-lg">{initials(selectedEmployee.full_name)}</span>
                <div className="selected-employee-copy">
                  <span className="eyebrow">ĐANG LẬP PHIẾU CHO</span>
                  <strong>{selectedEmployee.full_name}</strong>
                  <span>
                    {selectedEmployee.branch_name} · Mã {selectedEmployee.employee_code || selectedEmployee.employee_id}
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setSelectedEmployeeId('')}
                  aria-label="Bỏ chọn nhân viên"
                >
                  <X size={17} />
                </button>
              </div>

              <div className="panel composer-panel">
                <div className="form-grid two">
                  <label className="field">
                    <span className="field-label">
                      Ngày vi phạm <small>bắt buộc</small>
                    </span>
                    <div className="input-with-icon">
                      <CalendarDays size={16} />
                      <input
                        className="input"
                        type="date"
                        value={violationDate}
                        onChange={event => setViolationDate(event.target.value || todayIso())}
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">
                      Kỳ ghi nhận <small>tự động</small>
                    </span>
                    <input className="input" value={violationDate.slice(0, 7)} readOnly />
                  </label>
                </div>

                <div className="composer-section-head">
                  <div>
                    <span className="eyebrow">
                      <CirclePlus size={13} /> BƯỚC 2
                    </span>
                    <h3>Danh sách lỗi vi phạm</h3>
                  </div>
                  <button type="button" className="btn btn-gold btn-sm" onClick={() => setPickerOpen(true)}>
                    <Plus size={15} /> Thêm lỗi vi phạm
                  </button>
                </div>

                {items.length === 0 ? (
                  <button type="button" className="composer-dropzone" onClick={() => setPickerOpen(true)}>
                    <CirclePlus size={24} />
                    <strong>Chưa có lỗi vi phạm nào</strong>
                    <span>Bấm để chọn từ bộ quy chế công ty.</span>
                  </button>
                ) : (
                  <div className="item-list">
                    {items.map((item, index) => (
                      <div key={item.regulation_id} className="item-row">
                        <span className="item-index">{String(index + 1).padStart(2, '0')}</span>
                        <div className="item-copy">
                          <strong>{item.name}</strong>
                          <span>
                            {item.category}
                            {item.fine_note ? ` · ${item.fine_note}` : ''}
                          </span>
                        </div>
                        <label className="money-input">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={item.fine_amount ? item.fine_amount.toLocaleString('vi-VN') : ''}
                            placeholder={item.fine_note ? 'Nhập số tiền' : '0'}
                            onChange={event => updateFine(item.regulation_id, event.target.value)}
                          />
                          <span>đ</span>
                        </label>
                        <button
                          type="button"
                          className="icon-button icon-button-danger"
                          onClick={() => removeItem(item.regulation_id)}
                          aria-label={`Xóa ${item.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <label className="field">
                  <span className="field-label">
                    Ghi chú <small>không bắt buộc</small>
                  </span>
                  <textarea
                    className="input textarea"
                    rows={3}
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    placeholder="Mô tả thêm tình huống vi phạm, người chứng kiến, biên bản..."
                  />
                </label>

                <div className="composer-total">
                  <div className="composer-total-copy">
                    <span>
                      <Wallet size={15} /> Tổng mức phạt
                    </span>
                    <small>{items.length} lỗi vi phạm được chọn</small>
                  </div>
                  <strong>{money(total)}</strong>
                </div>

                <div className="composer-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => void save('PENDING')} disabled={!!saving}>
                    {saving === 'PENDING' ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
                    Lưu tạm
                  </button>
                  <button
                    type="button"
                    className="btn btn-gold"
                    onClick={() => setAskApprove(true)}
                    disabled={!!saving}
                  >
                    {saving === 'APPROVED' ? <Loader2 size={16} className="spin" /> : <Gavel size={16} />}
                    Duyệt phiếu
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Chọn lỗi vi phạm"
        subtitle="Có thể chọn nhiều lỗi cho cùng một phiếu. Mức phạt sẽ được điền sẵn theo quy chế."
        size="lg"
        footer={
          <>
            <span className="modal-foot-note">Đã chọn {items.length} lỗi</span>
            <button type="button" className="btn btn-gold" onClick={() => setPickerOpen(false)}>
              <Check size={16} /> Xong
            </button>
          </>
        }
      >
        <div className="picker-toolbar">
          <label className="search-box">
            <Search size={16} />
            <input
              value={pickerSearch}
              onChange={event => setPickerSearch(event.target.value)}
              placeholder="Tìm lỗi vi phạm..."
            />
            {pickerSearch ? (
              <button type="button" onClick={() => setPickerSearch('')} aria-label="Xóa tìm kiếm">
                <X size={14} />
              </button>
            ) : null}
          </label>
          <label className="select-wrap">
            <select value={pickerCategory} onChange={event => setPickerCategory(event.target.value)}>
              <option value="ALL">Tất cả nhóm</option>
              {pickerCategories.map(category => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="picker-list">
          {pickerResults.map(regulation => {
            const added = items.some(item => item.regulation_id === regulation.regulation_id);
            return (
              <button
                key={regulation.regulation_id}
                type="button"
                className={`picker-row ${added ? 'is-added' : ''}`}
                onClick={() => addRegulation(regulation)}
              >
                <span className="regulation-code">{regulation.code}</span>
                <span className="picker-copy">
                  <strong>{regulation.name}</strong>
                  <span>
                    {regulation.category} · {regulation.fine_note || money(regulation.fine_amount)}
                  </span>
                </span>
                <span className={`picker-add ${added ? 'is-added' : ''}`}>
                  {added ? <Check size={16} /> : <Plus size={16} />}
                </span>
              </button>
            );
          })}
          {pickerResults.length === 0 ? (
            <EmptyState icon={<Search size={20} />} title="Không tìm thấy lỗi phù hợp" description="Thử từ khóa hoặc nhóm khác." />
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={askApprove}
        title="Duyệt phiếu vi phạm?"
        message={
          <>
            Phiếu của <strong>{selectedEmployee?.full_name || 'nhân viên'}</strong> với tổng phạt{' '}
            <strong className="text-red">{money(total)}</strong> sẽ được duyệt ngay.
            <br />
            Hệ thống sẽ lưu PDF lên Google Drive và cộng khoản phạt vào <strong>TRỪ KPI</strong> của kỳ{' '}
            <strong>{violationDate.slice(0, 7)}</strong>. Thao tác này không thể hoàn tác.
          </>
        }
        confirmLabel="Duyệt và đồng bộ"
        busy={saving === 'APPROVED'}
        onConfirm={() => void save('APPROVED')}
        onCancel={() => setAskApprove(false)}
      />
    </div>
  );
}
