/**
 * Hệ thống âm thanh thông báo Web Audio API cho Admin & HR (Ụm Bò Milk)
 * Chạy 100% native trong trình duyệt, không phụ thuộc file mp3/wav ngoài,
 * đảm bảo không bao giờ lỗi 404 hay chậm trễ.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch (e) {
    return null;
  }
}

/** Kiểm tra người dùng có bật âm thanh không (mặc định bật) */
export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('ubm_sound_enabled') !== 'false';
}

/** Bật / Tắt âm thanh */
export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('ubm_sound_enabled', enabled ? 'true' : 'false');
  if (enabled) {
    playSuccessChime();
  }
}

/**
 * 1. Âm thanh chuông thông báo 2 nốt (Ding - Dong ngân dài)
 * Dùng khi CÔNG NHÂN VIÊN thao tác: Check-in, Check-out, Nộp đơn OFF, Đổi ca, Đổi PIN...
 */
export function playNotificationDing(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Nốt 1: 880Hz (A5)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(880, now);
  gain1.gain.setValueAtTime(0.001, now);
  gain1.gain.exponentialRampToValueAtTime(0.25, now + 0.03);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.36);

  // Nốt 2: 1320Hz (E6) ngân vang
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1318.5, now + 0.12);
  gain2.gain.setValueAtTime(0.001, now + 0.12);
  gain2.gain.exponentialRampToValueAtTime(0.3, now + 0.15);
  gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.12);
  osc2.stop(now + 0.71);
}

/**
 * 2. Hợp âm thành công (Success Arpeggio Chime: C5 - E5 - G5)
 * Dùng khi ADMIN / HR bấm nút thao tác: Kích hoạt, Gửi PIN Zalo, Duyệt đơn, Tạo lịch, Publish...
 */
export function playSuccessChime(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

  notes.forEach((freq, idx) => {
    const startTime = now + idx * 0.07;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.32);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.33);
  });
}

/**
 * 3. Âm cảnh báo nhẹ (Warning Tone)
 * Dùng khi thao tác gặp lỗi, trùng SĐT hoặc cảnh báo quan trọng
 */
export function playWarningTone(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(330, now + 0.25);

  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.29);
}

/**
 * 5. Chuông thông báo hiện đại (Modern Glass Chime)
 * Âm glockenspiel 3 nốt ngân + lấp lánh overtone — chuông chung cho mọi toast realtime.
 */
export function playModernChime(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  // E6 - G6 - B6: hợp âm Em lấp lánh, hiện đại
  const notes = [1318.5, 1568.0, 1975.5];

  notes.forEach((freq, idx) => {
    const startTime = now + idx * 0.09;
    // Nốt chính (sine, ngân vang)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.22, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.9);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.92);
    // Overtone lấp lánh (gấp đôi tần số, nhỏ hơn, tắt nhanh)
    const spark = ctx.createOscillator();
    const sparkGain = ctx.createGain();
    spark.type = 'sine';
    spark.frequency.setValueAtTime(freq * 2, startTime);
    sparkGain.gain.setValueAtTime(0.001, startTime);
    sparkGain.gain.exponentialRampToValueAtTime(0.06, startTime + 0.015);
    sparkGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.35);
    spark.connect(sparkGain);
    sparkGain.connect(ctx.destination);
    spark.start(startTime);
    spark.stop(startTime + 0.37);
  });
}

/**
 * 6. Báo giờ phỏng vấn (Interview Alert)
 * Chuông 2 tông khẩn trương lặp 3 lần — khác mọi âm khác để HR nhận ra ngay.
 */
export function playInterviewAlert(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  for (let round = 0; round < 3; round++) {
    const base = now + round * 0.42;
    // Cặp 2 tông khẩn trương (A5 -> E6)
    const pairs: Array<[number, number]> = [[880, 0], [1318.5, 0.16]];
    for (const [freq, off] of pairs) {
      const t = base + off;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    }
  }
}

/**
 * 7. Nhạc chiến thắng (Fanfare)
 * Fanfare C-E-G-C-E-G-C lên cao — dùng khi ứng viên đạt tuyệt đối / duyệt thành công.
 */
export function playFanfare(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const seq: Array<[number, number]> = [
    [523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36],
    [783.99, 0.52], [1046.5, 0.6], [1318.5, 0.76],
  ];
  for (const [freq, off] of seq) {
    const t = now + off;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.52);
  }
}

/**
 * 8. Bộ kiểu chuông thông báo cho HR tự chọn (nghe thử + đặt mặc định trên cổng Admin).
 * Tất cả Web Audio thuần, không file ngoài.
 */

export type NotificationSoundStyle = 'modern' | 'gentle' | 'bubbly' | 'digital' | 'warm' | 'custom' | 'ringtune';

export const NOTIFICATION_SOUND_STYLES: Array<{ id: NotificationSoundStyle; label: string; desc: string }> = [
  { id: 'ringtune', label: '🎵 Nhạc chuông hệ thống', desc: 'File ringtune.mp4 kèm theo code' },
  { id: 'modern', label: '💎 Hiện đại (Glass)', desc: 'Glockenspiel 3 nốt lấp lánh' },
  { id: 'gentle', label: '🍃 Nhẹ nhàng (Gentle)', desc: 'Marimba êm, tấn công chậm, thư giãn' },
  { id: 'bubbly', label: '🫧 Vui tươi (Bubbly)', desc: 'Bong bóng bay lên, trẻ trung' },
  { id: 'digital', label: '⚡ Công nghệ (Digital)', desc: 'Ping sắc + echo, gọn hiện đại' },
  { id: 'warm', label: '🔔 Ấm áp (Warm Bell)', desc: 'Chuông trầm ngân dài, sang trọng' },
  { id: 'custom', label: '🎵 Riêng (mp3 tải lên)', desc: 'Nhạc chuông bạn tự tải lên' },
];

const CUSTOM_RINGTONE_KEY = 'ubm_custom_ringtone';
/** Giới hạn 3MB để vừa localStorage trình duyệt. */
export const CUSTOM_RINGTONE_MAX_BYTES = 3 * 1024 * 1024;

/** File mp3 nhạc chuông riêng HR đã tải lên (data URL). */
export function getCustomRingtone(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(CUSTOM_RINGTONE_KEY);
  } catch {
    return null;
  }
}

export function setCustomRingtone(dataUrl: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CUSTOM_RINGTONE_KEY, dataUrl);
}

export function clearCustomRingtone(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CUSTOM_RINGTONE_KEY);
  } catch { /* ignore */ }
}

/** Phát nhạc chuông mp3 riêng (fallback về chuông hiện đại nếu chưa có file). */
export function playCustomRingtone(): void {  if (!isSoundEnabled()) return;
  const dataUrl = getCustomRingtone();
  if (!dataUrl) {
    playModernChime();
    return;
  }
  try {
    const audio = new Audio(dataUrl);
    audio.volume = 0.9;
    audio.play().catch(() => playModernChime());
  } catch {
    playModernChime();
  }
}

const SOUND_STYLE_KEY = 'ubm_notification_sound_style';

export function getNotificationSoundStyle(): NotificationSoundStyle {
  if (typeof window === 'undefined') return 'ringtune';
  const v = localStorage.getItem(SOUND_STYLE_KEY);
  return NOTIFICATION_SOUND_STYLES.some(s => s.id === v) ? (v as NotificationSoundStyle) : 'ringtune';
}

export function setNotificationSoundStyle(style: NotificationSoundStyle): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SOUND_STYLE_KEY, style);
}

/** Nốt nhạc gọn dùng chung cho các kiểu chuông mới. */
function tone(
  ctx: AudioContext,
  opts: { freq: number; at: number; dur: number; type?: OscillatorType; vol?: number; glideTo?: number }
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(opts.freq, opts.at);
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, opts.at + opts.dur * 0.7);
  const vol = opts.vol ?? 0.2;
  gain.gain.setValueAtTime(0.001, opts.at);
  gain.gain.exponentialRampToValueAtTime(vol, opts.at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(opts.at);
  osc.stop(opts.at + opts.dur + 0.02);
}

/** Nhẹ nhàng: marimba êm C5-E5-G5, tấn công chậm. */
export function playGentleChime(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((f, i) => {
    tone(ctx, { freq: f, at: now + i * 0.14, dur: 0.7, type: 'triangle', vol: 0.14 });
    tone(ctx, { freq: f / 2, at: now + i * 0.14, dur: 0.7, type: 'sine', vol: 0.07 });
  });
}

/** Vui tươi: bong bóng bay lên, 3 nốt glide nhanh. */
export function playBubblyChime(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  [420, 560, 720].forEach((f, i) => {
    tone(ctx, { freq: f, glideTo: f * 2.1, at: now + i * 0.09, dur: 0.22, type: 'sine', vol: 0.2 });
  });
  tone(ctx, { freq: 1050, glideTo: 2100, at: now + 0.28, dur: 0.3, type: 'sine', vol: 0.16 });
}

/** Công nghệ: ping sắc + echo gọn. */
export function playDigitalPing(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  tone(ctx, { freq: 1568, at: now, dur: 0.18, type: 'square', vol: 0.06 });
  tone(ctx, { freq: 2093, at: now + 0.02, dur: 0.25, type: 'sine', vol: 0.18 });
  tone(ctx, { freq: 2093, at: now + 0.22, dur: 0.3, type: 'sine', vol: 0.1 });
}

/** Ấm áp: chuông trầm G3-C4-E4 ngân dài. */
export function playWarmBell(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  [196.0, 261.63, 329.63].forEach((f, i) => {
    tone(ctx, { freq: f, at: now + i * 0.16, dur: 1.4, type: 'sine', vol: 0.2 });
    tone(ctx, { freq: f * 2.01, at: now + i * 0.16, dur: 0.6, type: 'sine', vol: 0.05 });
  });
}

/** Phát file nhạc chuông kèm theo code (public/sounds/ringtune.mp4). Lỗi -> chuông hiện đại. */
export function playRingtuneFile(): void {
  if (!isSoundEnabled()) return;
  try {
    const url = new URL('sounds/ringtune.mp4', document.baseURI).href;
    const audio = new Audio(url);
    audio.volume = 0.9;
    audio.play().catch(() => playModernChime());
  } catch {
    playModernChime();
  }
}

/** Phát chuông theo kiểu HR đã chọn (mặc định: nhạc chuông hệ thống). */
export function playNotificationByStyle(style?: NotificationSoundStyle): void {
  switch (style || getNotificationSoundStyle()) {
    case 'ringtune':
      return playRingtuneFile();
    case 'gentle':
      return playGentleChime();
    case 'bubbly':
      return playBubblyChime();
    case 'digital':
      return playDigitalPing();
    case 'warm':
      return playWarmBell();
    case 'custom':
      return playCustomRingtone();
    case 'modern':
    default:
      return playModernChime();
  }
}

/**
 * 4. Micro-click Haptic Tone
 * Dùng khi bấm các nút bấm chức năng tạo cảm giác phản hồi xúc giác
 */
export function playButtonPop(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + 0.04);

  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}
