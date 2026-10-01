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
