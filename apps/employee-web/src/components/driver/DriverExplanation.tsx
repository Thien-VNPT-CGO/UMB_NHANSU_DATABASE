/**
 * Tab "Giải trình" của APP TÀI XẾ.
 *
 * Dùng khi tài xế mắc bất kỳ lỗi nào trên hệ thống vận chuyển:
 *  - Quên bấm xác nhận tại chi nhánh (điểm bỏ lọt).
 *  - Đến trễ so với SLA/giờ quy định (bị trừ phạt trễ giờ).
 *  - Chọn NHIỀU lỗi (có thể thuộc nhiều ca/chi nhánh khác nhau).
 *  - Nhập nội dung giải trình.
 *  - Tải NHIỀU ảnh bằng chứng cùng lúc (client nén trước khi gửi).
 *  - Gửi thẳng Kế toán/Giám đốc duyệt; duyệt xong được đền bù phạt và tính
 *    hoàn thành ca làm.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Camera, CheckCircle2, ClipboardList, Clock3, ImagePlus, Send, ShieldCheck, Trash2, XCircle,
} from 'lucide-react';
import {
  BigButton, Card, DC, Empty, Pill, ScreenTitle, fmtDay, fmtTime,
} from './driver-shared';
import type { DriverData } from './useDriverData';
import {
  MAX_EXPLANATION_PHOTOS,
  MAX_TOTAL_DATA_URL_CHARS,
  compressExplanationPhoto,
} from './image-compress';

const EXPLANATION_STATUS: Record<string, { text: string; fg: string; bg: string }> = {
  PENDING: { text: 'Chờ Kế toán/GĐ duyệt', fg: '#1D4ED8', bg: '#EFF6FF' },
  APPROVED: { text: 'Đã duyệt — đền bù phạt', fg: DC.success, bg: DC.successSoft },
  REJECTED: { text: 'Từ chối', fg: DC.danger, bg: DC.dangerSoft },
};

type LocalPhoto = { id: string; name: string; data_url: string; mime_type: string; size_bytes: number };

const isLateIssue = (it: any) => it?.issue_type === 'LATE_SLA';
const issueText = (it: any) => isLateIssue(it)
  ? `Trễ ${Number(it?.late_minutes) || 0} phút so với SLA`
  : 'Quên bấm xác nhận';
const fmtMoney = (n: any) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;

export function DriverExplanation({
  d, showToast, focus, onFocusUsed,
}: {
  d: DriverData;
  showToast: (m: string) => void;
  focus?: { shiftId: string; stopId: string } | null;
  onFocusUsed?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const candidates = d.explanationCandidates || [];
  const tickets = d.explanationTickets || [];
  const pendingTickets = tickets.filter((t: any) => t.status === 'PENDING');
  const missedCount = candidates.filter((c: any) => !isLateIssue(c)).length;
  const lateCount = candidates.filter(isLateIssue).length;

  const keyOf = (c: any) => `${c.shift_id}::${c.stop_id}`;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedPenalty = useMemo(
    () => candidates.reduce((n: number, c: any) => (selectedSet.has(keyOf(c)) ? n + (Number(c.penalty_amount) || 0) : n), 0),
    [candidates, selectedSet],
  );

  // Nhóm điểm theo ngày + ca để tài xế dễ chọn.
  const groups = useMemo(() => {
    const map = new Map<string, { shiftId: string; shiftDate: string; routeName?: string; items: any[] }>();
    for (const c of candidates) {
      const k = `${c.shift_id}`;
      if (!map.has(k)) {
        map.set(k, {
          shiftId: c.shift_id,
          shiftDate: String(c.shift_date || '').slice(0, 10),
          routeName: c.route_name,
          items: [],
        });
      }
      map.get(k)!.items.push(c);
    }
    return Array.from(map.values()).sort((a, b) =>
      b.shiftDate.localeCompare(a.shiftDate) || (a.routeName || '').localeCompare(b.routeName || '', 'vi'));
  }, [candidates]);

  // Được điều hướng từ nút "Giải trình" ở tab Hôm nay → tự chọn sẵn điểm đó.
  useEffect(() => {
    if (!focus) return;
    const key = `${focus.shiftId}::${focus.stopId}`;
    if (!candidates.some((c: any) => keyOf(c) === key)) return;
    setSelected((prev) => (prev.includes(key) ? prev : [...prev, key]));
    onFocusUsed?.();
    requestAnimationFrame(() => {
      document.getElementById(`exp-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, candidates]);

  const toggle = (c: any) => {
    const key = keyOf(c);
    setSelected((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const totalChars = photos.reduce((n, p) => n + p.data_url.length, 0);

  const pickPhotos = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const room = MAX_EXPLANATION_PHOTOS - photos.length;
    if (room <= 0) { showToast(`⚠️ Tối đa ${MAX_EXPLANATION_PHOTOS} ảnh mỗi phiếu.`); return; }
    const list = Array.from(files).slice(0, room);
    setPreparing(true);
    const added: LocalPhoto[] = [];
    let chars = totalChars;
    try {
      for (const file of list) {
        if (!/^image\//i.test(file.type)) {
          showToast(`⚠️ Bỏ qua "${file.name}" — không phải tệp ảnh.`);
          continue;
        }
        try {
          const c = await compressExplanationPhoto(file);
          if (chars + c.data_url.length > MAX_TOTAL_DATA_URL_CHARS) {
            showToast('⚠️ Tổng dung lượng ảnh quá lớn — chọn ít ảnh hơn hoặc ảnh nhẹ hơn.');
            break;
          }
          chars += c.data_url.length;
          added.push({
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name: c.name,
            data_url: c.data_url,
            mime_type: c.mime_type,
            size_bytes: c.size_bytes,
          });
        } catch (e: any) {
          showToast(`⚠️ ${e?.message || `Không xử lý được ảnh ${file.name}.`}`);
        }
      }
      if (added.length) setPhotos((p) => [...p, ...added]);
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = (id: string) => setPhotos((p) => p.filter((x) => x.id !== id));

  const submit = async () => {
    if (!selected.length) { showToast('⚠️ Chọn ít nhất 1 điểm cần giải trình.'); return; }
    if (!reason.trim()) { showToast('⚠️ Nhập nội dung giải trình.'); return; }
    if (!photos.length) { showToast('⚠️ Tải lên ít nhất 1 ảnh bằng chứng.'); return; }
    const ok = await d.createExplanation({
      reason,
      items: selected.map((k) => {
        const [shift_id, stop_id] = k.split('::');
        return { shift_id, stop_id };
      }),
      photos: photos.map((p) => ({ data_url: p.data_url, mime_type: p.mime_type, name: p.name })),
    });
    if (ok) {
      setSelected([]);
      setReason('');
      setPhotos([]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScreenTitle
        title="Phiếu giải trình"
        sub="Bất kỳ lỗi nào (quên chấm điểm, trễ giờ/SLA…) đều lập phiếu tại đây. Chọn lỗi, mô tả lý do và gửi ảnh bằng chứng."
      />

      <Card style={{ backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <ShieldCheck size={17} color={DC.blue} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#1E40AF', lineHeight: 1.65 }}>
            Phiếu chuyển <b>thẳng Kế toán và Giám đốc</b> duyệt (không qua HR).
            Khi được duyệt, lỗi được <b>đền bù phạt</b>, ca làm được tính <b>hoàn thành</b> và
            hồ sơ tài xế không còn ghi nhận vi phạm.
          </div>
        </div>
      </Card>

      {pendingTickets.length > 0 && (
        <Card style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 800, color: DC.warn }}>
            <Clock3 size={15} /> {pendingTickets.length} phiếu đang chờ duyệt
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginTop: 4, lineHeight: 1.6 }}>
            Lỗi trong phiếu đang chờ duyệt chưa bị trừ phạt cho đến khi có kết quả.
          </div>
        </Card>
      )}

      {/* ------------------- CHỌN ĐIỂM ------------------- */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <ClipboardList size={16} color={DC.brand} />
          <div style={{ fontSize: 13.5, fontWeight: 900, color: DC.ink }}>Lỗi cần giải trình</div>
          <span style={{ marginLeft: 'auto' }}>
            <Pill
              text={`${selected.length}/${candidates.length} đã chọn`}
              fg={selected.length ? DC.brandDark : DC.muted}
              bg={selected.length ? DC.brandSoft : '#F1F5F9'}
            />
          </span>
        </div>

        {(missedCount > 0 || lateCount > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {missedCount > 0 && <Pill text={`${missedCount} quên chấm điểm`} fg={DC.danger} bg={DC.dangerSoft} />}
            {lateCount > 0 && <Pill text={`${lateCount} trễ giờ/SLA`} fg={DC.warn} bg={DC.warnSoft} />}
            {selectedPenalty > 0 && <Pill text={`Đền bù dự kiến ${fmtMoney(selectedPenalty)}`} fg={DC.success} bg={DC.successSoft} />}
          </div>
        )}

        {!candidates.length ? (
          <Empty
            icon={<CheckCircle2 size={34} color={DC.success} />}
            title="Không có lỗi nào cần giải trình"
            desc="Mọi điểm giao đã được xác nhận đúng giờ hoặc đã có phiếu giải trình đang chờ/đã duyệt."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {groups.map((g) => (
              <div key={g.shiftId} style={{ border: `1px solid ${DC.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                  padding: '8px 10px', backgroundColor: DC.bg, borderBottom: `1px solid ${DC.border}`,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: DC.ink }}>{fmtDay(g.shiftDate)}</span>
                  {g.routeName && <span style={{ fontSize: 10.5, fontWeight: 700, color: DC.muted }}>• {g.routeName}</span>}
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {g.items.map((c: any) => {
                    const key = keyOf(c);
                    const checked = selectedSet.has(key);
                    return (
                      <button
                        key={key}
                        id={`exp-${key}`}
                        type="button"
                        onClick={() => toggle(c)}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 9, textAlign: 'left',
                          padding: '9px 10px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                          border: `1.5px solid ${checked ? DC.brand : DC.border}`,
                          backgroundColor: checked ? DC.brandSoft : '#FFFFFF',
                        }}
                      >
                        <span style={{
                          width: 19, height: 19, borderRadius: 5, flexShrink: 0, marginTop: 1,
                          border: `2px solid ${checked ? DC.brand : '#CBD5E1'}`,
                          backgroundColor: checked ? DC.brand : '#FFFFFF',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          color: '#FFFFFF',
                        }}>
                          {checked && <CheckCircle2 size={13} />}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: DC.ink }}>
                            {c.stop_order ? `${c.stop_order}. ` : ''}{c.stop_name}
                          </span>
                          {c.address && (
                            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: DC.muted, marginTop: 2, lineHeight: 1.5 }}>
                              {c.address}
                            </span>
                          )}
                          <span style={{
                            display: 'block', fontSize: 10, fontWeight: 800, marginTop: 2,
                            color: isLateIssue(c) ? DC.warn : DC.danger,
                          }}>
                            {issueText(c)}
                            {Number(c.penalty_amount) > 0 ? ` • phạt ${fmtMoney(c.penalty_amount)}` : ''}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ------------------- NỘI DUNG + ẢNH ------------------- */}
      {candidates.length > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
            <Camera size={16} color={DC.brand} />
            <div style={{ fontSize: 13.5, fontWeight: 900, color: DC.ink }}>Nội dung & ảnh bằng chứng</div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: DC.muted, marginBottom: 5 }}>
            Nội dung giải trình <span style={{ color: DC.danger }}>*</span>
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 2000))}
            placeholder="VD: Đến chi nhánh lúc 9h nhưng điện thoại mất mạng nên không bấm xác nhận được. Có ảnh giao hàng và biên nhận kèm theo."
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              borderRadius: 11, border: `1.5px solid ${DC.border}`, padding: '10px 11px',
              fontSize: 12.5, fontFamily: 'inherit', color: DC.ink, lineHeight: 1.6,
              backgroundColor: '#FFFFFF', outline: 'none',
            }}
          />
          <div style={{ fontSize: 10, fontWeight: 600, color: DC.muted, textAlign: 'right', marginTop: 2 }}>
            {reason.length}/2000
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, marginBottom: 7 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: DC.muted }}>
              Ảnh bằng chứng <span style={{ color: DC.danger }}>*</span>
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: DC.muted }}>
              ({photos.length}/{MAX_EXPLANATION_PHOTOS})
            </span>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => void pickPhotos(e.target.files)}
            style={{ display: 'none' }}
          />

          {photos.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 9 }}>
              {photos.map((p) => (
                <div key={p.id} style={{ position: 'relative', width: 82, height: 82 }}>
                  <img
                    src={p.data_url}
                    alt={p.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10, border: `1px solid ${DC.border}` }}
                  />
                  <button
                    type="button"
                    title="Xóa ảnh"
                    onClick={() => removePhoto(p.id)}
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 999,
                      border: '1.5px solid #FFFFFF', backgroundColor: DC.danger, color: '#FFFFFF',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <BigButton
            tone="ghost"
            disabled={preparing || photos.length >= MAX_EXPLANATION_PHOTOS}
            onClick={() => fileRef.current?.click()}
            style={{ padding: '11px 12px', fontSize: 12.5, borderStyle: 'dashed' }}
          >
            <ImagePlus size={15} />
            {preparing ? 'ĐANG XỬ LÝ ẢNH...' : photos.length >= MAX_EXPLANATION_PHOTOS ? 'ĐÃ ĐỦ ẢNH' : 'CHỌN NHIỀU ẢNH CÙNG LÚC'}
          </BigButton>

          <BigButton
            onClick={() => void submit()}
            disabled={!!d.busy || preparing || !selected.length || !reason.trim() || !photos.length}
            style={{ marginTop: 10 }}
          >
            <Send size={16} />
            {d.busy === 'explanation'
              ? 'ĐANG GỬI PHIẾU...'
              : `GỬI PHIẾU GIẢI TRÌNH (${selected.length} lỗi)`}
          </BigButton>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 9, fontSize: 10.5, fontWeight: 600, color: DC.muted, lineHeight: 1.6 }}>
            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            Ảnh được nén tự động trên điện thoại trước khi gửi để phiếu gửi nhanh và không bị lỗi dung lượng.
          </div>
        </Card>
      )}

      {/* ------------------- PHIẾU ĐÃ GỬI ------------------- */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <ClipboardList size={16} color={DC.brand} />
          <div style={{ fontSize: 13.5, fontWeight: 900, color: DC.ink }}>Phiếu giải trình của tôi</div>
          <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: DC.muted }}>{tickets.length} phiếu</span>
        </div>

        {!tickets.length ? (
          <div style={{ fontSize: 12, fontWeight: 600, color: DC.muted, padding: '8px 2px', lineHeight: 1.6 }}>
            Chưa gửi phiếu giải trình nào.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {tickets.map((t: any) => {
              const st = EXPLANATION_STATUS[t.status] || EXPLANATION_STATUS.PENDING;
              return (
                <div key={t.ticket_id} style={{
                  border: `1.5px solid ${t.status === 'PENDING' ? '#BFDBFE' : t.status === 'APPROVED' ? '#A7F3D0' : '#FECACA'}`,
                  borderRadius: 12, padding: '10px 11px',
                  backgroundColor: t.status === 'PENDING' ? '#EFF6FF' : t.status === 'APPROVED' ? '#F0FDF4' : '#FEF2F2',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: DC.ink }}>
                      {t.ticket_code || t.ticket_id.slice(0, 8)}
                    </span>
                    <span style={{ marginLeft: 'auto' }}><Pill text={st.text} fg={st.fg} bg={st.bg} /></span>
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: DC.muted, marginTop: 4 }}>
                    Gửi lúc {fmtTime(t.created_at)} • {fmtDay(String(t.created_at).slice(0, 10))}
                    {t.photos?.length ? ` • ${t.photos.length} ảnh` : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 7 }}>
                    {(t.items || []).map((it: any, idx: number) => (
                      <div key={`${it.shift_id}_${it.stop_id}_${idx}`} style={{ fontSize: 11.5, fontWeight: 700, color: DC.ink }}>
                        • {fmtDay(it.shift_date)} — {it.stop_name}
                        <span style={{ fontWeight: 800, color: isLateIssue(it) ? DC.warn : DC.danger }}>
                          {' '}· {issueText(it)}
                        </span>
                        {Number(it.penalty_amount) > 0 && (
                          <span style={{ fontWeight: 700, color: DC.muted }}> · phạt {fmtMoney(it.penalty_amount)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {Number(t.total_penalty_amount) > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 800, color: t.status === 'APPROVED' ? DC.success : DC.muted, marginTop: 5 }}>
                      {t.status === 'APPROVED' ? '💰 Đã đền bù phạt' : '💰 Đền bù dự kiến'}: {fmtMoney(t.total_penalty_amount)}
                    </div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 600, color: DC.muted, marginTop: 6, lineHeight: 1.6 }}>
                    📝 {t.reason}
                  </div>
                  {t.status === 'APPROVED' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: DC.success, marginTop: 5 }}>
                      <CheckCircle2 size={12} /> Đã duyệt{String(t.approved_by_name || '').trim() ? ` bởi ${t.approved_by_name}` : ''}
                      {t.approved_at ? ` lúc ${fmtTime(t.approved_at)}` : ''} — đền bù phạt, ca được tính hoàn thành.
                    </div>
                  )}
                  {t.status === 'REJECTED' && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 10.5, fontWeight: 700, color: DC.danger, marginTop: 5, lineHeight: 1.5 }}>
                      <XCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                      {t.rejected_reason || 'Phiếu bị từ chối.'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
