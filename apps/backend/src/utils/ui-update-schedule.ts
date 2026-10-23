/**
 * Chuẩn hóa lịch "Cập nhật giao diện mới" do Admin gửi lên.
 * - Tắt: xóa mốc giờ để cổng NV không đếm ngược ma.
 * - Bật: bắt buộc mốc giờ hợp lệ, lưu dạng ISO UTC để client so sánh tuyệt đối.
 * Tách khỏi route để unit-test được và dùng chung nếu có luồng khác.
 */
export interface UiUpdatePatch {
  ui_update_enabled: boolean;
  ui_update_at: string | null;
  ui_update_message: string;
}

export type NormalizeUiUpdateResult =
  | { ok: true; patch: UiUpdatePatch }
  | { ok: false; message: string };

export function normalizeUiUpdateSchedule(input: any): NormalizeUiUpdateResult {
  const message = String(input?.ui_update_message || '').slice(0, 500);
  const enabled = !!input?.ui_update_enabled;
  if (!enabled) {
    return { ok: true, patch: { ui_update_enabled: false, ui_update_at: null, ui_update_message: message } };
  }
  const at = Date.parse(String(input?.ui_update_at || ''));
  if (!Number.isFinite(at)) {
    return { ok: false, message: 'Vui lòng chọn ngày giờ cập nhật giao diện hợp lệ!' };
  }
  return {
    ok: true,
    patch: { ui_update_enabled: true, ui_update_at: new Date(at).toISOString(), ui_update_message: message },
  };
}
