/**
 * Logic lưới chấm công dùng chung 2 cổng (Admin "Bảng Chấm Công Thời Gian Thực"
 * + Nhân viên "Dữ Liệu Công Của Tôi"): cùng 1 code nên trạng thái ca, gộp lượt
 * mồ côi, đơn giá đúng giai đoạn và lương/phạt tạm tính KHỚP NHAU 100% realtime.
 * Finance vẫn chốt số chính thức ở kỳ lương.
 */
/** Ngày Việt Nam (UTC+7) của 1 mốc ISO. */
export function vnDayOf(iso) {
    const t = new Date(iso || '').getTime();
    if (!Number.isFinite(t))
        return '';
    return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}
/** Trạng thái 1 ca chấm công theo đúng luật (xanh/vàng nhấp nháy/xám/đỏ/cam/chàm). */
export function attShiftStatus(shift, inEvt, outEvt, absentEvt) {
    const complete = !!(inEvt && outEvt);
    if (complete)
        return { key: 'COMPLETED', label: '✓ Hoàn thành', bg: '#ECFDF5', fg: '#047857', border: '1px solid #A7F3D0', blink: false, lateMin: 0 };
    const todayStr = vnDayOf(new Date().toISOString());
    const shiftDay = String(shift?.date || '').slice(0, 10);
    // Chốt cứng: ngày đã qua mà thiếu check-out (kể cả end_at lỗi) -> hết nhấp nháy
    if (inEvt && !outEvt && shiftDay && shiftDay < todayStr)
        return { key: 'MISSING_OUT', label: 'Thiếu check-out — không lương', bg: '#FFF7ED', fg: '#9A3412', border: '1.5px solid #EA580C', blink: false, lateMin: 0 };
    const startMs = shift?.start_at ? new Date(shift.start_at).getTime() : NaN;
    const endMs = shift?.end_at ? new Date(shift.end_at).getTime() : NaN;
    const now = Date.now();
    if (!inEvt && absentEvt)
        return { key: 'ABSENT', label: '🔴 Vắng — không lương', bg: '#FEE2E2', fg: '#991B1B', border: '1.5px solid #EF4444', blink: false, lateMin: 0 };
    if (!inEvt && Number.isFinite(startMs) && now - startMs > 3 * 60 * 60 * 1000)
        return { key: 'LOCKED', label: '🔒 Khóa — nghỉ không lương', bg: '#F1F5F9', fg: '#475569', border: '1.5px solid #64748B', blink: false, lateMin: 0 };
    if (inEvt && !outEvt && Number.isFinite(endMs) && now - endMs > 30 * 60 * 1000)
        return { key: 'MISSING_OUT', label: 'Thiếu check-out — không lương', bg: '#FFF7ED', fg: '#9A3412', border: '1.5px solid #EA580C', blink: false, lateMin: 0 };
    if (!inEvt && Number.isFinite(startMs) && now < startMs - 30 * 60 * 1000)
        return { key: 'UPCOMING', label: 'Lịch đã duyệt', bg: '#EEF2FF', fg: '#3730A3', border: '1px solid #C7D2FE', blink: false, lateMin: 0 };
    const lateMin = inEvt?.is_late ? Number(inEvt.minutes_deviation) || 0 : 0;
    if (inEvt)
        return { key: 'CHECKED_IN', label: 'Đang làm (chờ check-out)', bg: '#FEF3C7', fg: '#92400E', border: '1px solid #F59E0B', blink: true, lateMin };
    return { key: 'PENDING', label: 'Chưa check-in', bg: '#FEF3C7', fg: '#92400E', border: '1px solid #FCD34D', blink: false, lateMin: 0 };
}
/**
 * Gộp nhóm điểm danh mồ côi (không gắn ca / gắn ca đã mất) vào đúng ca live
 * trong ngày: hết hiện 2 thẻ cho 1 ca đã làm (vừa "Khóa" oan vừa thẻ "Tự điểm
 * danh"). Chỉ nhận khi ca còn thiếu check-in và giờ vào lọt khung giờ ca
 * (vào sớm 60p → tan +30p); nhóm đã gộp thì đánh dấu để vòng thẻ thừa bỏ qua.
 */
export function mergeOrphanCheckins(dayShifts, byAssign, usedAssign, statusByAssign, shiftByAssign) {
    const out = new Map();
    const ordered = [...(dayShifts || [])].filter((s) => s?.assignment_id);
    if (ordered.length === 0)
        return out;
    const dayIso = String(ordered[0]?.date || '').slice(0, 10);
    const liveIds = new Set(ordered.map((s) => String(s.assignment_id)));
    const isOrphanKey = (k) => {
        if (!k || k.startsWith('__'))
            return true;
        if (liveIds.has(k))
            return false;
        const st = statusByAssign.get(k);
        if (!st || st === 'CANCELLED')
            return true;
        // Gắn ca live nhưng KHÁC NGÀY (VD sau khi HR sửa/xếp lại lịch): vẫn là mồ côi
        // của ngày này -> cho gộp để ca điểm danh hiện lại. Cùng ngày thì giữ nguyên
        // (tránh thẻ ma khi danh sách ca chưa tải lại).
        const fday = String(shiftByAssign?.get(k)?.date || '').slice(0, 10);
        if (fday && dayIso && fday !== dayIso)
            return true;
        return false;
    };
    const hasIn = (list) => (list || []).some((e) => e?.type === 'CHECK_IN');
    const inWindow = (sh, iso) => {
        const t = new Date(iso || '').getTime();
        const s = sh?.start_at ? new Date(sh.start_at).getTime() : NaN;
        const e = sh?.end_at ? new Date(sh.end_at).getTime() : NaN;
        if (!Number.isFinite(t) || !Number.isFinite(s) || !Number.isFinite(e))
            return false;
        return t >= s - 60 * 60 * 1000 && t <= e + 30 * 60 * 1000;
    };
    for (const [k, list] of byAssign) {
        if (usedAssign.has(k) || !isOrphanKey(k))
            continue;
        const ci = (list || []).find((e) => e?.type === 'CHECK_IN');
        if (!ci)
            continue;
        const target = ordered.find((sh) => {
            const id = String(sh.assignment_id);
            const cur = byAssign.get(id) || [];
            if (hasIn(cur) || hasIn(out.get(id) || []))
                return false;
            return inWindow(sh, ci?.client_time);
        });
        if (!target)
            continue;
        const id = String(target.assignment_id);
        out.set(id, [...(out.get(id) || []), ...(list || []).filter((e) => ['CHECK_IN', 'CHECK_OUT'].includes(e?.type))]);
        usedAssign.add(k);
    }
    return out;
}
/**
 * Lương + phạt 1 ca (mirror payroll.service lateFineFor để lưới realtime hiện ngay,
 * Finance chốt số chính thức ở kỳ lương):
 * trễ <5p: không phạt; 5–29p: -30k; 30–59p: -50% lương ca; ≥60p hoặc thiếu in/out: 0đ.
 */
export const SHIFT_HOURS_MAP = { CA_1: 5, CA_2: 6, CA_3: 5 };
/** Đơn giá thử việc chuẩn (đồng bộ STANDARD_HOURLY_RATES.PROBATION của server). */
export const TV_RATE_VND = 21000;
/** Đơn giá đúng giai đoạn của ngày công (mirror backend rateOnDate cho hiển thị realtime):
 *  ngày trước official_date tính lương thử việc, từ official_date tính lương hiện tại. */
export function rateOnDateOf(emp, isoDay) {
    const off = String(emp?.official_date || '').slice(0, 10);
    if (off && isoDay < off)
        return TV_RATE_VND;
    return Number(emp?.current_rate_per_hour) || 0;
}
/** Phút trễ: ưu tiên cờ server, mất cờ (dòng Sheet cũ) thì tính bù từ giờ vào ca. */
export function lateMinOf(inEvt, shiftStartAt) {
    if (inEvt?.is_late)
        return Number(inEvt.minutes_deviation) || 0;
    if (inEvt && (inEvt.is_late === undefined || inEvt.is_late === null)) {
        const st = new Date(shiftStartAt || '').getTime();
        const ct = new Date(inEvt.client_time || '').getTime();
        if (Number.isFinite(st) && Number.isFinite(ct))
            return Math.max(0, Math.round((ct - st) / 60000));
    }
    return 0;
}
/** Suy ca ngoài lịch từ giờ check-in VN (realtime, chỉ để tạm tính hiển thị — không đổi công/lương chính thức). */
export function inferExtraShiftCode(inEvt, empDefaultShift) {
    try {
        const t = new Date(inEvt?.client_time || '').getTime();
        if (Number.isFinite(t)) {
            const vn = new Date(t + 7 * 3_600_000);
            const h = vn.getUTCHours() + vn.getUTCMinutes() / 60;
            if (h >= 5 && h < 11.5)
                return 'CA_1';
            if (h >= 11.5 && h < 17.5)
                return 'CA_2';
            return 'CA_3';
        }
    }
    catch { /* fallback bên dưới */ }
    const d = String(empDefaultShift || '');
    if (['CA_1', 'CA_2', 'CA_3'].includes(d))
        return d;
    return 'CA_2';
}
export function shiftPayInfo(shiftCode, ratePerHour, inEvt, outEvt, shiftStartAt) {
    const hours = SHIFT_HOURS_MAP[shiftCode] ?? 5;
    const rate = Number(ratePerHour) || 0;
    const shiftPay = hours * rate;
    const lateMin = lateMinOf(inEvt, shiftStartAt);
    if (!inEvt || !outEvt) {
        return { hours, rate, shiftPay, lateMin, fineLabel: 'Thiếu check-in/out — không lương', deduction: 0, net: 0, unpaid: true };
    }
    // Ưu tiên mức phạt server đã ghi nhận lúc check-in (ràng buộc chặt, không tính lại).
    const storedTier = inEvt?.fine_tier;
    if (storedTier && storedTier !== 'NONE') {
        const amt = Number(inEvt.fine_amount) || 0;
        if (storedTier === 'FULL_SHIFT') {
            return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${Math.floor(lateMin)}p — phạt 100% (không lương, đã ghi nhận)`, deduction: 0, net: 0, unpaid: true };
        }
        return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${Math.floor(lateMin)}p — phạt ${amt.toLocaleString('vi-VN')}đ (đã ghi nhận)`, deduction: amt, net: Math.max(0, shiftPay - amt), unpaid: false };
    }
    const m = Math.floor(lateMin);
    if (m < 5)
        return { hours, rate, shiftPay, lateMin, fineLabel: 'Đúng giờ — không phạt', deduction: 0, net: shiftPay, unpaid: false };
    if (m < 30)
        return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${m}p — phạt 30.000đ`, deduction: 30000, net: Math.max(0, shiftPay - 30000), unpaid: false };
    if (m < 60) {
        const d = Math.round(shiftPay * 0.5);
        return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${m}p — phạt 50% lương ca`, deduction: d, net: shiftPay - d, unpaid: false };
    }
    return { hours, rate, shiftPay, lateMin, fineLabel: `Trễ ${m}p — phạt 100% (không lương)`, deduction: 0, net: 0, unpaid: true };
}
