import React, { useEffect, useRef, useState } from 'react';

interface SignaturePadProps {
  /** Tiêu đề ô ký (VD: Người lập phiếu). */
  label: string;
  /** Ảnh chữ ký đã lưu (dataURL) — null = chưa ký. */
  value: string | null;
  /** Tên người ký hiển thị dưới chữ ký. */
  signerName: string;
  onSave: (dataUrl: string, name: string) => void;
  onClear: () => void;
}

/**
 * Ô ký điện tử: bấm "Ký" mở bảng vẽ (chuột/cảm ứng), lưu thành ảnh PNG
 * hiển thị ngay trên phiếu + in được. Chữ ký do người dùng vẽ tay trên
 * thiết bị của mình nên có giá trị đối soát nội bộ.
 */
export const SignaturePad: React.FC<SignaturePadProps> = ({ label, value, signerName, onSave, onClear }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(signerName || '');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const strokedRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (open) setName(signerName || '');
  }, [open, signerName]);

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 440;
    const H = 180;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = '100%';
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#1E3A8A';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return { ctx, W, H };
  };

  useEffect(() => {
    if (!open) return;
    setupCanvas();
    strokedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const posOf = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 440,
      y: ((e.clientY - r.top) / r.height) * 180,
    };
  };

  const clearCanvas = () => {
    setupCanvas();
    strokedRef.current = false;
  };

  const handleSave = () => {
    if (!strokedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL('image/png'), name.trim());
    setOpen(false);
  };

  return (
    <div style={{ flex: 1, minWidth: '150px', textAlign: 'center' }}>
      <div style={{ fontWeight: 800, fontSize: '12px' }}>{label}</div>
      <div
        style={{
          marginTop: '6px', minHeight: '86px', borderRadius: '8px',
          border: value ? '1px solid #A7F3D0' : '1.5px dashed #CBD5E1',
          backgroundColor: value ? '#F0FDF4' : '#F8FAFC',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '6px', cursor: value ? 'default' : 'pointer',
        }}
        onClick={() => { if (!value) setOpen(true); }}
        title={value ? 'Đã ký điện tử' : 'Bấm để ký điện tử'}
      >
        {value ? (
          <img src={value} alt={`Chữ ký ${label}`} style={{ maxWidth: '100%', maxHeight: '74px', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: '12px', color: '#64748B' }}>✍️ Bấm để ký điện tử</span>
        )}
      </div>
      <div style={{ fontSize: '12px', marginTop: '4px', minHeight: '18px', fontWeight: value ? 700 : 400, color: value ? '#111827' : '#9CA3AF' }}>
        {value ? (signerName || '(đã ký)') : '(Ký, ghi rõ họ tên)'}
      </div>
      {value ? (
        <button className="btn-secondary" style={{ fontSize: '11px', padding: '4px 10px', marginTop: '2px' }} onClick={onClear}>
          Ký lại
        </button>
      ) : null}

      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{ backgroundColor: '#FFF', borderRadius: '14px', padding: '18px', width: '100%', maxWidth: '500px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '4px' }}>✍️ Ký điện tử — {label}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>Vẽ chữ ký trong khung (chuột hoặc ngón tay), ghi tên rồi bấm Lưu.</div>
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: '180px', borderRadius: '8px', border: '1.5px solid #93C5FD', backgroundColor: '#FFF', touchAction: 'none', cursor: 'crosshair' }}
              onPointerDown={e => {
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                drawingRef.current = true;
                lastRef.current = posOf(e);
              }}
              onPointerMove={e => {
                if (!drawingRef.current) return;
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (!canvas || !ctx) return;
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                ctx.save();
                ctx.scale(dpr, dpr);
                const p = posOf(e);
                const last = lastRef.current || p;
                ctx.beginPath();
                ctx.moveTo(last.x, last.y);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
                ctx.restore();
                lastRef.current = p;
                strokedRef.current = true;
              }}
              onPointerUp={() => { drawingRef.current = false; lastRef.current = null; }}
              onPointerLeave={() => { drawingRef.current = false; lastRef.current = null; }}
            />
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Họ tên người ký..."
              style={{ marginTop: '10px', width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn-secondary" style={{ fontSize: '12px', padding: '8px 14px' }} onClick={clearCanvas}>🧹 Vẽ lại</button>
              <button className="btn-secondary" style={{ fontSize: '12px', padding: '8px 14px' }} onClick={() => setOpen(false)}>Đóng</button>
              <button className="btn-primary" style={{ fontSize: '12px', padding: '8px 18px', fontWeight: 800, backgroundColor: '#059669' }} onClick={handleSave}>💾 Lưu chữ ký</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignaturePad;
