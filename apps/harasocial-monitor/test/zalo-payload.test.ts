import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOaGroupPayload,
  buildOaUserPayload,
  buildWebhookPayload,
  checkWebhookResponse,
  checkZaloApiResponse,
} from '../shared/zalo-payload';
import type { SalesStaff } from '../shared/types';

const staff: SalesStaff = {
  id: 's1', ownerUid: 'u1', name: 'Nguyễn Văn A', zaloTag: 'Văn A', zaloUserId: '1234567',
  role: 'sale', shift: '', active: true, monitorChannelId: null, monitorChannelIds: [],
  externalHrId: null, email: null,
};

test('payload webhook trung gian đúng cấu trúc Make/n8n', () => {
  const payload = buildWebhookPayload({
    groupId: 'g1',
    groupName: 'Nhóm Sale',
    taggedStaff: [staff],
    title: 'Tiêu đề',
    message: 'Nội dung',
    text: 'Text đầy đủ',
  });
  assert.deepEqual(payload, {
    groupId: 'g1',
    groupName: 'Nhóm Sale',
    taggedStaff: [{ id: 's1', name: 'Nguyễn Văn A', zaloTag: 'Văn A', zaloUserId: '1234567' }],
    title: 'Tiêu đề',
    message: 'Nội dung',
    text: 'Text đầy đủ',
    category: 'harasocial_sla_alert',
  });
});

test('payload Zalo OA Nhóm (GMF v3.0) và OA 1-1', () => {
  assert.deepEqual(buildOaGroupPayload('g1', 'Xin chào'), {
    recipient: { group_id: 'g1' },
    message: { text: 'Xin chào' },
  });
  assert.deepEqual(buildOaUserPayload('u1', 'Xin chào'), {
    recipient: { user_id: 'u1' },
    message: { text: 'Xin chào' },
  });
});

test('Zalo trả HTTP 200 nhưng error !== 0 => thất bại', () => {
  const result = checkZaloApiResponse(200, { error: 1001, message: 'Invalid access token' });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 1001);
  assert.match(result.message, /Invalid access token/);
});

test('Zalo trả error = 0 => thành công; HTTP lỗi => thất bại', () => {
  assert.equal(checkZaloApiResponse(200, { error: 0, message: 'Success' }).success, true);
  assert.equal(checkZaloApiResponse(200, { error: '0' }).success, true);
  assert.equal(checkZaloApiResponse(500, { error: 0 }).success, false);
  assert.equal(checkZaloApiResponse(200, null).success, false);
  assert.equal(checkZaloApiResponse(200, { success: false, message: 'Nope' }).success, false);
});

test('webhook trả HTML trang đăng nhập => coi là thất bại', () => {
  const result = checkWebhookResponse(200, '<!doctype html><html>Cookie check</html>');
  assert.equal(result.success, false);
  assert.match(result.message, /HTML/);
  assert.equal(checkWebhookResponse(200, '{"ok":true}').success, true);
  assert.equal(checkWebhookResponse(302, '').success, false);
});
