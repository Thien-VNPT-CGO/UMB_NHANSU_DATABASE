import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConversationId,
  detectSender,
  normalizeChannel,
  parseHarasocialApiResponse,
  parseHarasocialPayload,
  parseHarasocialWebhook,
  parseTimestamp,
  slugChannelKey,
} from '../shared/harasocial';

test('parse webhook phẳng: khách, kênh, nội dung, thời gian', () => {
  const [conv] = parseHarasocialWebhook({
    conversationId: 'conv-1',
    customerName: 'Nguyễn Thị Lan',
    channel: 'facebook',
    message: 'Shop ơi còn hàng không?',
    sender: 'customer',
    timestamp: '2026-06-01T03:00:00Z',
  });
  assert.equal(conv.externalId, 'conv-1');
  assert.equal(conv.customerName, 'Nguyễn Thị Lan');
  assert.equal(conv.channel, 'Facebook');
  assert.equal(conv.lastMessage, 'Shop ơi còn hàng không?');
  assert.equal(conv.lastSender, 'customer');
  assert.equal(conv.at.toISOString(), '2026-06-01T03:00:00.000Z');
});

test('parse API response lồng data.conversations + message object', () => {
  const list = parseHarasocialApiResponse({
    data: {
      conversations: [
        {
          id: 'c2',
          customer: { name: 'Chị Hoa' },
          platform: 'zalo_oa',
          lastMessage: { text: 'Tư vấn giúp em', sender: 'page' },
          updated_at: '2026-06-01T04:00:00Z',
        },
        {
          id: 'c3',
          customer_name: 'Anh Tú',
          channel: 'instagram',
          last_message_text: 'Giá bao nhiêu?',
          last_sender: 'customer',
          last_message_at: '2026-06-01T04:05:00Z',
        },
      ],
    },
  });
  assert.equal(list.length, 2);
  assert.equal(list[0].customerName, 'Chị Hoa');
  assert.equal(list[0].channel, 'Zalo OA');
  assert.equal(list[0].lastSender, 'staff');
  assert.equal(list[1].channel, 'Instagram');
  assert.equal(list[1].lastMessage, 'Giá bao nhiêu?');
});

test('nhận diện tin do page gửi qua pageId / direction / senderType', () => {
  assert.equal(detectSender({ sender: 'outbound' }), 'staff');
  assert.equal(detectSender({ direction: 'inbound' }), 'customer');
  assert.equal(detectSender({ from: { id: 'PAGE1', type: 'page' } }, 'PAGE1'), 'staff');
  assert.equal(detectSender({ from: { id: 'USER9', type: 'user' } }, 'PAGE1'), 'customer');
  assert.equal(detectSender({ isFromCustomer: true }), 'customer');
  assert.equal(detectSender({ senderType: 'agent' }), 'staff');
});

test('chuẩn hoá tên kênh', () => {
  assert.equal(normalizeChannel('facebook'), 'Facebook');
  assert.equal(normalizeChannel('fb'), 'Facebook');
  assert.equal(normalizeChannel('zalo'), 'Zalo OA');
  assert.equal(normalizeChannel('ZALO_OA'), 'Zalo OA');
  assert.equal(normalizeChannel('instagram'), 'Instagram');
  assert.equal(normalizeChannel('livechat'), 'Livechat');
  assert.equal(normalizeChannel(''), 'Livechat');
  assert.equal(normalizeChannel('TikTok'), 'TikTok');
});

test('timestamp hỗ trợ giây, mili-giây và chuỗi dd/mm/yyyy giờ Việt Nam', () => {
  assert.equal(parseTimestamp(1748746800).toISOString(), '2025-06-01T03:00:00.000Z');
  assert.equal(parseTimestamp(1748746800000).toISOString(), '2025-06-01T03:00:00.000Z');
  assert.equal(parseTimestamp('01/06/2026 08:30').toISOString(), '2026-06-01T01:30:00.000Z');
  assert.equal(parseTimestamp('2026-06-01T03:00:00Z').toISOString(), '2026-06-01T03:00:00.000Z');
});

test('ID hội thoại scope theo cổng, không ghi đè giữa các cổng', () => {
  const a = buildConversationId('ch-facebook', 'conv-1');
  const b = buildConversationId('ch-zalo', 'conv-1');
  assert.notEqual(a, b);
  assert.equal(a, 'ch-facebook:conv-1');
  assert.equal(slugChannelKey('Fanpage Ụm Bò Milk'), 'fanpage-um-bo-milk');
});

test('thiếu conversationId vẫn tạo được ID ổn định theo tên khách', () => {
  const [conv] = parseHarasocialPayload({ customerName: 'Chị Lan', message: 'Hello', channel: 'facebook' });
  assert.match(conv.externalId, /^customer:chi-lan/);
});

test('payload mảng trực tiếp và bỏ qua phần tử rỗng', () => {
  const list = parseHarasocialPayload([
    { conversationId: 'x1', message: 'A', customerName: 'A' },
    {},
    { conversationId: 'x2', message: 'B', customerName: 'B' },
  ]);
  assert.equal(list.length, 2);
});

test('giữ assignedStaffId nếu HaraSocial trả về', () => {
  const [conv] = parseHarasocialPayload({ conversationId: 'c9', message: 'Hi', assigned_staff_id: 'staff-7' });
  assert.equal(conv.assignedStaffId, 'staff-7');
});
