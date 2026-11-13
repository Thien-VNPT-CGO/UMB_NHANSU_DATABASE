import React, { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Filter, Scale, Settings2, ShieldCheck } from 'lucide-react';
import { ApiError, fetchRegulations } from '../services/api';
import type { Regulation } from '../types';
import { EmptyState, SearchBox, Spinner, ViewHeader, money } from './ui';
import { useToast } from './toast';

interface Props {
  refreshKey: number;
  onAdjust: () => void;
}

export function RegulationsView({ refreshKey, onAdjust }: Props) {
  const toast = useToast();
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [onlyActive, setOnlyActive] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchRegulations()
      .then(items => {
        if (alive) setRegulations(items);
      })
      .catch(error => {
        if (alive) toast(error instanceof ApiError ? error.message : 'Không tải được quy chế.', 'error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, toast]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(regulations.map(item => item.category).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b, 'vi'));
  }, [regulations]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return regulations.filter(item => {
      if (onlyActive && item.active === false) return false;
      if (category !== 'ALL' && item.category !== category) return false;
      if (!keyword) return true;
      return `${item.code} ${item.name} ${item.category} ${item.description || ''}`.toLowerCase().includes(keyword);
    });
  }, [regulations, search, category, onlyActive]);

  const activeCount = regulations.filter(item => item.active !== false).length;

  return (
    <div className="view">
      <ViewHeader
        eyebrow={
          <>
            <BookOpenCheck size={13} /> QUY CHẾ CÔNG TY
          </>
        }
        title="Bộ luật đang áp dụng"
        description="Toàn bộ lỗi vi phạm và mức phạt có hiệu lực. Mọi thay đổi từ phòng Điều chỉnh Quy chế được cập nhật tức thời."
        actions={
          <button type="button" className="btn btn-ghost" onClick={onAdjust}>
            <Settings2 size={16} /> Điều chỉnh quy chế
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
            <strong>{activeCount}</strong>
          </div>
        </div>
        <div className="summary-item">
          <span className="summary-icon">
            <Scale size={18} />
          </span>
          <div>
            <span>Tổng số điều</span>
            <strong>{regulations.length}</strong>
          </div>
        </div>
        <div className="summary-item">
          <span className="summary-icon">
            <Filter size={18} />
          </span>
          <div>
            <span>Nhóm vi phạm</span>
            <strong>{categories.length}</strong>
          </div>
        </div>
        <div className="summary-item summary-item-wide">
          <div>
            <span>Mức phạt cao nhất</span>
            <strong className="text-red">
              {money(regulations.reduce((max, item) => Math.max(max, item.fine_amount || 0), 0))}
            </strong>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Tìm theo mã, tên lỗi hoặc nhóm..." />
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
          <label className="switch-line">
            <input type="checkbox" checked={onlyActive} onChange={event => setOnlyActive(event.target.checked)} />
            <span className="switch" />
            Chỉ hiện hiệu lực
          </label>
        </div>
      </div>

      {loading ? <Spinner label="Đang tải quy chế..." /> : null}

      {!loading && filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpenCheck size={22} />}
          title="Không tìm thấy quy chế phù hợp"
          description="Thử xóa từ khóa tìm kiếm hoặc chọn nhóm vi phạm khác."
        />
      ) : null}

      <div className="regulation-list">
        {filtered.map(item => (
          <article key={item.regulation_id} className={`regulation-row ${item.active === false ? 'is-inactive' : ''}`}>
            <div className="regulation-code">{item.code || 'QC'}</div>
            <div className="regulation-main">
              <div className="regulation-title-line">
                <strong>{item.name}</strong>
                {item.active === false ? <span className="pill pill-muted">Tạm ngưng</span> : null}
              </div>
              {item.description ? <p>{item.description}</p> : null}
            </div>
            <span className="category-chip">{item.category}</span>
            <div className="regulation-fine">
              <span>Mức phạt</span>
              <strong>{item.fine_note && !(item.fine_amount > 0) ? item.fine_note : money(item.fine_amount)}</strong>
              {item.fine_note && item.fine_amount > 0 ? <small>{item.fine_note}</small> : null}
            </div>
          </article>
        ))}
      </div>

      {!loading && filtered.length > 0 ? (
        <p className="list-footnote">
          Đang hiển thị {filtered.length}/{regulations.length} điều quy chế.
        </p>
      ) : null}
    </div>
  );
}
