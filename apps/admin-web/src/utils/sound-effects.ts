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
