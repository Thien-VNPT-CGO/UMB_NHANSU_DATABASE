import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { ApiError, fetchRegulations, removeRegulation, saveRegulation } from '../services/api';
import type { Regulation } from '../types';
import { ConfirmDialog, EmptyState, Modal, SearchBox, Spinner, ViewHeader, money } from './ui';
import { useToast } from './toast';

interface Props {
  refreshKey: number;
}

interface Draft {
  regulation_id?: string;
  code: string;
  name: string;
  category: string;
  fine: string;
  description: string;
  active: boolean;
}

const EMPTY_DRAFT: Draft = {
  code: '',
  name: '',
  category: 'CHUNG',
  fine: '',
  description: '',
  active: true,
};

export function AdjustRegulationsView({ refreshKey }: Props) {
  const toast = useToast();
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Regulation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchRegulations()
      .then(items => {
        if (alive) setRegulations(items);
      })
      .catch(err => {
        if (alive) toast(err instanceof ApiError ? err.message : 'Không tải được quy chế.', 'error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, version, toast]);

  const categories = useMemo(
    () => Array.from(new Set(regulations.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi')),
    [regulations],
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return regulations.filter(item => {
      if (category !== 'ALL' && item.category !== category) return false;
      if (!keyword) return true;
      return `${item.code} ${item.name} ${item.category} ${item.description || ''}`.toLowerCase().includes(keyword);
    });
  }, [regulations, search, category]);

  const openCreate = () => {
    setError('');
    setDraft({ ...EMPTY_DRAFT });
  };

  const openEdit = (regulation: Regulation) => {
    setError('');
    setDraft({
      regulation_id: regulation.regulation_id,
      code: regulation.code,
      name: regulation.name,
      category: regulation.category,
      fine: String(regulation.fine_amount ?? ''),
      description: regulation.description || '',
      active: regulation.active !== false,
    });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || saving) return;
    if (!draft.name.trim()) {
      setError('Vui lòng nhập tên quy chế / lỗi vi phạm.');
      return;
    }
    if (!draft.category.trim()) {
      setError('Vui lòng nhập nhóm vi phạm.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await saveRegulation({
        regulation_id: draft.regulation_id,
        code: draft.code.trim(),
        name: draft.name.trim(),
        category: draft.category.trim(),
        fine_amount: Number(draft.fine.replace(/[^\d]/g, '') || 0),
        description: draft.description.trim(),
        active: draft.active,
      });
      setRegulations(current => {
        const exists = current.some(item => item.regulation_id === saved.regulation_id);
        const next = exists
          ? current.map(item => (item.regulation_id === saved.regulation_id ? saved : item))
          : [saved, ...current];
        return next.sort((a, b) => a.code.localeCompare(b.code, 'vi'));
      });
      toast(draft.regulation_id ? 'Đã cập nhật quy chế.' : 'Đã thêm quy chế mới.', 'success');
      setDraft(null);
      setVersion(value => value + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể lưu quy chế.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await removeRegulation(deleteTarget.regulation_id);
      setRegulations(current => current.filter(item => item.regulation_id !== deleteTarget.regulation_id));
      toast('Đã xóa quy chế khỏi hệ thống.', 'success');
      setDeleteTarget(null);
      setVersion(value => value + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Không thể xóa quy chế.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="view">
      <ViewHeader
        eyebrow={
          <>
            <Settings2 size={13} /> ĐIỀU CHỈNH QUY CHẾ
          </>
        }
        title="Hiệu chỉnh bộ luật"
        description="Thêm, sửa hoặc xóa quy chế và mức phạt. Mọi thay đổi được đồng bộ realtime sang Quy chế Công ty và phiếu vi phạm."
        actions={
          <button type="button" className="btn btn-gold" onClick={openCreate}>
            <Plus size={16} /> Thêm quy chế
          </button>
        }
      />

      <div className="summary-strip">
        <div className="summary-item">
          <span className="summary-icon">
            <ShieldCheck size={18} />
          </span>
          <div>
            <span>Đang hiệu lực</span>
            <strong>{regulations.filter(item => item.active !== false).length}</strong>
          </div>
        </div>
        <div className="summary-item">
          <span className="summary-icon">
            <BookOpenCheck size={18} />
          </span>
          <div>
            <span>Tổng số điều</span>
            <strong>{regulations.length}</strong>
          </div>
        </div>
        <div className="summary-item summary-item-wide">
          <div>
            <span>Nhóm vi phạm</span>
            <strong>{categories.length}</strong>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Tìm quy chế cần điều chỉnh..." />
        <div className="toolbar-right">
          <label className="select-wrap">
            <select value={category} onChange={event => setCategory(event.target.value)}>
              <option value="ALL">Tất cả nhóm</option>
              {categories.map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVersion(value => value + 1)}>
            Làm mới
          </button>
        </div>
      </div>

      {loading ? <Spinner label="Đang tải quy chế..." /> : null}

      {!loading && filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpenCheck size={22} />}
          title="Chưa có quy chế phù hợp"
          description="Thêm quy chế mới hoặc xóa bộ lọc hiện tại."
          action={
            <button type="button" className="btn btn-gold btn-sm" onClick={openCreate}>
              <Plus size={15} /> Thêm quy chế
            </button>
          }
        />
      ) : null}

      <div className="regulation-list">
        {filtered.map(item => (
          <article key={item.regulation_id} className={`regulation-row regulation-row-editable ${item.active === false ? 'is-inactive' : ''}`}>
            <div className="regulation-code">{item.code || 'QC'}</div>
            <div className="regulation-main">
              <div className="regulation-title-line">
                <strong>{item.name}</strong>
                {item.active === false ? <span className="pill pill-muted">Tạm ngưng</span> : <span className="pill pill-green">Hiệu lực</span>}
              </div>
              {item.description ? <p>{item.description}</p> : null}
              <span className="category-chip">{item.category}</span>
            </div>
            <div className="regulation-fine">
              <span>Mức phạt</span>
              <strong>{money(item.fine_amount)}</strong>
            </div>
            <div className="row-actions">
              <button type="button" className="icon-button" onClick={() => openEdit(item)} aria-label={`Sửa ${item.name}`}>
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="icon-button icon-button-danger"
                onClick={() => setDeleteTarget(item)}
                aria-label={`Xóa ${item.name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>

      <Modal
        open={!!draft}
        onClose={() => (saving ? undefined : setDraft(null))}
        title={draft?.regulation_id ? 'Sửa quy chế' : 'Thêm quy chế mới'}
        subtitle="Tên và mức phạt sẽ hiển thị ngay trong Quy chế Công ty và màn hình bắt lỗi."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)} disabled={saving}>
              Hủy
            </button>
            <button type="submit" form="regulation-form" className="btn btn-gold" disabled={saving}>
              {saving ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
              {draft?.regulation_id ? 'Lưu thay đổi' : 'Thêm quy chế'}
            </button>
          </>
        }
      >
        {draft ? (
          <form id="regulation-form" className="form-stack" onSubmit={save}>
            <div className="form-grid two">
              <label className="field">
                <span className="field-label">
                  Mã quy chế <small>tự động nếu trống</small>
                </span>
                <input
                  className="input"
                  value={draft.code}
                  onChange={event => setDraft({ ...draft, code: event.target.value })}
                  placeholder="VD: QC-015"
                  maxLength={40}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  Nhóm vi phạm <small>bắt buộc</small>
                </span>
                <input
                  className="input"
                  list="violation-categories"
                  value={draft.category}
                  onChange={event => setDraft({ ...draft, category: event.target.value })}
                  placeholder="VD: TÁC PHONG"
                  maxLength={60}
                />
                <datalist id="violation-categories">
                  {categories.map(item => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
            </div>

            <label className="field">
              <span className="field-label">
                Tên quy chế / lỗi vi phạm <small>bắt buộc</small>
              </span>
              <input
                className="input"
                value={draft.name}
                onChange={event => setDraft({ ...draft, name: event.target.value })}
                placeholder="VD: Không đeo bảng tên"
                maxLength={200}
              />
            </label>

            <label className="field">
              <span className="field-label">Mức phạt</span>
              <div className="money-input money-input-wide">
                <input
                  type="text"
                  inputMode="numeric"
                  value={draft.fine ? Number(draft.fine.replace(/[^\d]/g, '') || 0).toLocaleString('vi-VN') : ''}
                  onChange={event => setDraft({ ...draft, fine: event.target.value.replace(/[^\d]/g, '') })}
                  placeholder="0"
                />
                <span>đ</span>
              </div>
            </label>

            <label className="field">
              <span className="field-label">
                Mô tả <small>không bắt buộc</small>
              </span>
              <textarea
                className="input textarea"
                rows={3}
                value={draft.description}
                onChange={event => setDraft({ ...draft, description: event.target.value })}
                placeholder="Mô tả hành vi vi phạm để nhân viên hiểu rõ quy định..."
                maxLength={2000}
              />
            </label>

            <label className="switch-line switch-line-box">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={event => setDraft({ ...draft, active: event.target.checked })}
              />
              <span className="switch" />
              <span>
                <strong>Đang áp dụng</strong>
                <small>Tắt để tạm ngưng quy chế này khỏi màn hình bắt lỗi.</small>
              </span>
            </label>

            {error ? <div className="form-error form-error-box">{error}</div> : null}
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Xóa quy chế?"
        message={
          <>
            Quy chế <strong>{deleteTarget?.name}</strong> sẽ bị xóa khỏi bộ luật công ty. Các phiếu vi phạm đã tạo
            trước đó vẫn giữ nguyên mức phạt đã ghi.
          </>
        }
        confirmLabel="Xóa quy chế"
        tone="danger"
        busy={deleting}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
