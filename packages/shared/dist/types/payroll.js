"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PAYROLL_FORMULA = void 0;
exports.vietQrUrl = vietQrUrl;
/** URL ảnh VietQR động: đúng số tiền thực lãnh + nội dung = mã NV + kỳ lương. */
function vietQrUrl(cfg, amount, info) {
    const amt = Math.max(0, Math.round(Number(amount) || 0));
    const p = new URLSearchParams({
        amount: String(amt),
        addInfo: info.slice(0, 50),
        accountName: (cfg.holder || '').slice(0, 50),
    });
    return `https://img.vietqr.io/image/${encodeURIComponent(cfg.bank)}-${encodeURIComponent(cfg.account)}-compact2.png?${p.toString()}`;
}
exports.DEFAULT_PAYROLL_FORMULA = {
    rateTV: 21000,
    rateCT: 25500,
    otPerSlot: 30000,
    otThreshold1: 10,
    otThreshold2: 15,
};
