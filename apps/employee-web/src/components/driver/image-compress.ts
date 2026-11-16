/**
 * Nén ảnh bằng chứng ngay trên điện thoại trước khi gửi lên server.
 *
 * Vì sao cần: backend giới hạn JSON 10MB; ảnh camera điện thoại thường 3–8MB.
 * Nén về JPEG cạnh dài tối đa ~1280px, giảm dần chất lượng cho tới khi mỗi ảnh
 * ≤ ~700KB. Nhờ vậy tài xế gửi được nhiều ảnh cùng lúc mà không bị 413.
 */
export interface CompressedPhoto {
  data_url: string;
  mime_type: string;
  name: string;
  size_bytes: number;
}

export const MAX_EXPLANATION_PHOTOS = 8;
/** Tổng độ dài data-URL tối đa gửi trong 1 request (an toàn dưới limit 10MB). */
export const MAX_TOTAL_DATA_URL_CHARS = 7_000_000;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh (định dạng không hỗ trợ).'));
    img.src = src;
  });
}

function approxBytesOfDataUrl(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

export async function compressExplanationPhoto(file: File): Promise<CompressedPhoto> {
  if (!file.type || !/^image\//i.test(file.type)) {
    throw new Error('Chỉ chấp nhận tệp ảnh.');
  }
  const original = await readAsDataUrl(file);
  let dataUrl = original;
  try {
    const img = await loadImage(original);
    let maxDim = 1280;
    let quality = 0.72;
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const w = Math.max(1, Math.round((img.width || 1) * scale));
      const h = Math.max(1, Math.round((img.height || 1) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      // Nền trắng để ảnh PNG trong suốt không bị đen khi chuyển JPEG.
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (approxBytesOfDataUrl(dataUrl) <= 700_000) break;
      quality = Math.max(0.42, quality - 0.1);
      maxDim = Math.max(720, Math.round(maxDim * 0.82));
    }
  } catch {
    // Canvas/ảnh lỗi: dùng nguyên file gốc (vẫn được backend kiểm tra kích thước).
  }

  return {
    data_url: dataUrl,
    mime_type: dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
    name: file.name || 'anh-giai-trinh.jpg',
    size_bytes: approxBytesOfDataUrl(dataUrl),
  };
}
