/**
 * Gói ZIP tối giản (phương thức STORE - không nén, chỉ đóng gói) để tải
 * điểm danh theo folder ngày mà không cần thêm dependency (jszip).
 * Tương thích mọi trình unzip (Windows Explorer, 7-Zip, macOS Archive Utility).
 */

import zlib from 'zlib';

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Đường dẫn trong zip, dùng / (VD: 2026-09-28/CN130/EMP_x_IN.jpg). */
  name: string;
  data: Buffer;
  /** Thời gian file (mặc định hiện tại). */
  mtime?: Date;
  /**
   * Nén DEFLATE nội dung entry (dùng cho CSV/JSON văn bản — giảm 5–15 lần).
   * XLSX/JPEG/PNG đã nén sẵn nên để trống (STORE) cho nhanh.
   */
  compress?: boolean;
}

function dosDateTime(d: Date): { date: number; time: number } {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: ((((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate())) & 0xffff,
  };
}

export function buildZipStore(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const { date, time } = dosDateTime(entry.mtime || new Date());
    const raw = entry.data;
    const crc = crc32(raw);
    const size = raw.length;

    // Entry văn bản (CSV/JSON) nén rất tốt: DEFLATE giúp ZIP nhỏ 5–15 lần,
    // tránh vượt giới hạn payload khi upload qua webhook Apps Script.
    let method = 0;
    let payload = raw;
    if (entry.compress && raw.length > 256) {
      try {
        const deflated = zlib.deflateRawSync(raw, { level: 6 });
        if (deflated.length < raw.length) {
          method = 8;
          payload = deflated;
        }
      } catch { /* nén lỗi -> giữ STORE */ }
    }
    const packedSize = payload.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8
    local.writeUInt16LE(method, 8); // method: 0=STORE, 8=DEFLATE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packedSize, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    nameBuf.copy(local, 30);
    chunks.push(local, payload);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(packedSize, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);
    central.push(cd);

    offset += local.length + packedSize;
  }

  const centralStart = offset;
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, end]);
}
