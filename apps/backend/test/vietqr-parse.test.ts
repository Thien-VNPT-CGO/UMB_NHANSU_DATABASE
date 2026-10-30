import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeQrDataUrl, parseVietQRPartial, VIETQR_BANK_BY_BIN } from '../src/utils/vietqr.js';

/** Tạo 1 field EMVCo TLV: id (2 số) + độ dài (2 số) + giá trị. */
function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** Payload VietQR chuẩn: khối tài khoản lồng 2 tầng (BIN + STK). */
function buildVietQr(bin: string, account: string, holder: string): string {
  const nested = tlv('00', bin) + tlv('01', account);
  const acct = tlv('00', 'A000000727') + tlv('01', nested) + tlv('02', 'QRIBFTTA');
  return '000201' + tlv('38', acct) + tlv('59', holder) + '6304ABCD';
}

test('đọc đúng BIN/STK/tên chủ TK trong khối tài khoản lồng 2 tầng', () => {
  const p = parseVietQRPartial(buildVietQr('970403', '060123456789', 'NGUYEN VAN A'));
  assert.equal(p.isVietQR, true);
  assert.equal(p.bin, '970403');
  assert.equal(p.bank, 'Sacombank');
  assert.equal(p.account, '060123456789');
  assert.equal(p.holder, 'NGUYEN VAN A');
});

test('BIN Sacombank và SCB không còn bị nhầm', () => {
  assert.equal(VIETQR_BANK_BY_BIN['970403'], 'Sacombank');
  assert.equal(VIETQR_BANK_BY_BIN['970429'], 'SCB');
  const scb = parseVietQRPartial(buildVietQr('970429', '0123456789', 'TRAN THI B'));
  assert.equal(scb.bank, 'SCB');
});

test('QR không phải VietQR -> isVietQR = false (không báo lỗi ngân hàng oan)', () => {
  const p = parseVietQRPartial('https://example.com/khong-phai-vietqr');
  assert.equal(p.isVietQR, false);
  assert.equal(p.bank, '');
});

test('nhận diện đủ BIN ngân hàng số / ví điện tử / ngân hàng nước ngoài', () => {
  // Đây là các BIN từng thiếu trong bảng cũ khiến QR hợp lệ bị báo "không
  // nhận diện được ngân hàng".
  const cases: [string, string][] = [
    ['546034', 'CAKE'],
    ['546035', 'Ubank'],
    ['963388', 'Timo'],
    ['422589', 'CIMB'],
    ['458761', 'HSBC'],
    ['970462', 'KookminHN'],
    ['970463', 'KookminHCM'],
    ['970455', 'IBKHN'],
    ['971025', 'MoMo'],
    ['971101', 'ZaloPay'],
  ];
  for (const [bin, bank] of cases) {
    assert.equal(VIETQR_BANK_BY_BIN[bin], bank, `BIN ${bin}`);
    const p = parseVietQRPartial(buildVietQr(bin, '0123456789', 'NGUYEN VAN A'));
    assert.equal(p.bin, bin, `parse BIN ${bin}`);
    assert.equal(p.bank, bank, `parse bank ${bin}`);
    assert.equal(p.account, '0123456789');
  }
});

test('TLV lệch độ vẫn dò được BIN đã biết sau nhãn AID', () => {
  // Khối tài khoản bị hỏng độ dài (QR mờ/nghiêng): không đọc được TLV lồng,
  // nhưng vẫn phải dò ra BIN 546034 (CAKE) thay vì báo không nhận diện.
  const brokenAcct = tlv('00', 'A000000727') + tlv('01', 'AB') + '546034';
  const payload = '000201' + tlv('38', brokenAcct) + tlv('59', 'NGUYEN VAN A') + '6304ABCD';
  const p = parseVietQRPartial(payload);
  assert.equal(p.isVietQR, true);
  assert.equal(p.bin, '546034');
  assert.equal(p.bank, 'CAKE');
  assert.equal(p.holder, 'NGUYEN VAN A');
});

test('decodeQrDataUrl trả null an toàn với dữ liệu không phải ảnh hợp lệ', () => {
  assert.equal(decodeQrDataUrl(''), null);
  assert.equal(decodeQrDataUrl('data:image/png;base64,'), null);
  assert.equal(decodeQrDataUrl('data:image/png;base64,' + Buffer.from('not-a-png').toString('base64')), null);
  assert.equal(decodeQrDataUrl('data:image/jpeg;base64,' + Buffer.from('not-a-jpeg').toString('base64')), null);
});

// Ảnh QR PNG 1-bit palette (định dạng nhiều ngân hàng xuất ra) chứa payload
// VietQR MBBank bên dưới. Trước đây decodeQrDataUrl bỏ qua PNG và chỉ đọc 8-bit
// nên QR hợp lệ vẫn bị báo "không nhận diện được ngân hàng".
const QR_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAfQAAAH0AQMAAADxGE3JAAAABlBMVEX///8AAABVwtN+AAAACXBIWXMAAA7EAAAOxAGVKw4bAAACUklEQVR4nO3cTZICIQyGYSwXLOcIfRSP1h7No3gEly4sGSGEJP6VpUvebzV088zsUkCYTunHrCVk3x9nHe7KMf3Z212cfsTj8VP7gxUTnXG6/bwxnx6Hvfbg8fjZ/dJqyUV86sOQi5Lqe23C4/H4O78rtf5kr08p4fF4/Cf1pyaXqwKXPR6Px0c/Ygcm57rhkYfLrf5sBaSP9k94PB7/oQ+581Ldqr/a6sgFj8fP7F8kGwj9n0+Dx+Mn8FZ/2v4pRN+ebHItR2crR3g8fm4vK5QsIPXz294wLn13tJXjGNksZWkH4fH42X3Ncpt3lkcSV3DcHkd/Xf1TVxke8Xg8XqLlqPjzE8lG5xzVW/B4PP4bv7aHtWBt5b0shxwY5cz6zxfrDuHx+Hm9pu+fQv3Rho/rH+vUsP7B4/GzepnR6492iMf9k12bs/ULnrvzFzweP6t/cX7rhsHr+qVlvQ3wePzcPrULa0lLytj/6PltvX/yrn+Ex+Nn9TKjXiopdpwStkPj/mvpu6MS76/g8Xj8d/7QC1bfP2nG/smdv2g76Mn9NzweP6evyX7GuHBfejl69v0kPB6P1yWJ+35SAMWvXzRXPB6Pf4iA7EFfvyh4uH+Px+Pn9GsJ0RXK+H6Si74dvrT+Dx6Pn9cf4owAJO77JSmN+lNrDx6Px//mlzbrYhUqfD8paf/ZqtzD/Tc8Ho8f/u6EJfR/cnl3foPH42f2cv4ywKLrF82T+/d4PH5WP+LXL8l+XU3zax+E/z/G4/Hz+hA7v3V5Un96dxmPx+O/9z/mHwSAGaCuxpDPAAAAAElFTkSuQmCC';

test('decodeQrDataUrl đọc được QR từ ảnh PNG 1-bit palette', () => {
  const got = decodeQrDataUrl(`data:image/png;base64,${QR_PNG_BASE64}`);
  assert.equal(got, '00020138540010A00000072701240006970422011012345678900208QRIBFTTA5912NGUYEN VAN A6304ABCD');
  const p = parseVietQRPartial(got as string);
  assert.equal(p.bin, '970422');
  assert.equal(p.bank, 'MBBank');
  assert.equal(p.account, '1234567890');
  assert.equal(p.holder, 'NGUYEN VAN A');
});
