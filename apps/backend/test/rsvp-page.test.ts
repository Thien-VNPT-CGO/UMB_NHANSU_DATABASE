import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRsvpPage } from '../src/services/rsvp-page.js';

test('trang RSVP có khối "Đề xuất lịch mới" + khung giờ sáng/chiều', () => {
  const html = renderRsvpPage(
    'Xác nhận tham gia phỏng vấn',
    'Chào bạn!',
    { token: 'tok_123', name: 'Nguyễn Văn A', status: 'INVITED_INTERVIEW' },
    { badge: 'Đang chờ bạn xác nhận', tone: 'pending', info: [] }
  );
  assert.match(html, /id="declineReason"/);
  assert.match(html, /Đề xuất lịch mới/);
  assert.match(html, /Buổi sáng · 08:00 – 11:30/);
  assert.match(html, /Buổi chiều · 13:30 – 16:30/);
  assert.match(html, /id="propDate"/);
  assert.match(html, /id="slotSang"/);
  assert.match(html, /id="slotChieu"/);
  assert.match(html, /id="declineNote"/);
  // Gửi kèm đề xuất lên API
  assert.match(html, /proposedDate/);
  assert.match(html, /proposedTime/);
  assert.match(html, /proposedNote/);
  // Endpoint khung giờ tương đối đúng thư mục hiện tại
  assert.match(html, /\.\/rsvp\/slots/);
  // Khung giờ render sẵn ở server (không phụ thuộc JS/API): 7 sáng + 6 chiều.
  assert.equal((html.match(/class="slot"/g) || []).length, 13);
  assert.match(html, /data-time="08:00"/);
  assert.match(html, /data-time="11:00"/);
  assert.match(html, /data-time="13:30"/);
  assert.match(html, /data-time="16:00"/);
  // Khung HR đã có lịch họp bị ẩn hẳn + ghi chú khi kín cả buổi
  assert.match(html, /id="emptySang"/);
  assert.match(html, /id="emptyChieu"/);
  assert.match(html, /function showSlot/);
  assert.match(html, /function setSessionEmpty/);
});

test('trang RSVP không có khối thao tác khi không truyền ctx', () => {
  const html = renderRsvpPage('Đã ghi nhận', 'Cảm ơn bạn!', null, { badge: 'Đã ghi nhận', tone: 'muted' });
  assert.doesNotMatch(html, /id="bOk"/);
  assert.doesNotMatch(html, /Đề xuất lịch mới/);
});

test('ô chọn ngày có min = hôm nay (giờ VN)', () => {
  const html = renderRsvpPage('T', 'B', { token: 'x', name: 'A', status: 'INVITED_INTERVIEW' });
  const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  assert.match(html, new RegExp(`id="propDate" min="${todayVn}"`));
});
