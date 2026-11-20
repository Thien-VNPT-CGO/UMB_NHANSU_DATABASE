import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

/**
 * Nút "Toàn màn hình" dùng chung cho MỌI bảng của Cổng Kế toán.
 *
 * Bấm → phóng to đúng khối chứa nút (thẻ `.fin-card` gần nhất, hoặc phần tử
 * có `data-fs-card`), ẩn menu trái, khóa cuộn trang. Bấm lại / phím Esc → thu nhỏ,
 * menu hiện lại như cũ.
 *
 * Cách dùng: đặt <FinFullscreenButton /> trong phần actions của tiêu đề bảng.
 */
export function FinFullscreenButton({ className = 'fin-btn fin-btn-ghost fin-btn-sm', label = 'Toàn màn hình' }: { className?: string; label?: string }) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [full, setFull] = useState(false);

  const cardOf = useCallback(() => (
    (btnRef.current?.closest('.fin-card, [data-fs-card]') as HTMLElement | null) || null
  ), []);

  useEffect(() => {
    const card = cardOf();
    if (!card) return;
    if (!full) { card.classList.remove('fin-fs'); return; }
    card.classList.add('fin-fs');
    document.body.classList.add('fin-fs-open');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setFull(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      card.classList.remove('fin-fs');
      document.body.classList.remove('fin-fs-open');
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [full, cardOf]);

  return (
    <button
      ref={btnRef}
      type="button"
      className={className}
      onClick={() => setFull(v => !v)}
      title={full ? 'Thoát toàn màn hình (Esc)' : 'Xem bảng ở chế độ toàn màn hình'}
      aria-pressed={full}
    >
      {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      {full ? 'Thoát (Esc)' : label}
    </button>
  );
}
