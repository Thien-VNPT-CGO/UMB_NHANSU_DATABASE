#!/usr/bin/env python3
"""
generate-pwa-icons.py
Tạo bộ icon PWA và Apple Touch Icon đạt chuẩn 100% từ file logo.jpg (gốc 4167x4167):
- Nền trắng đặc (#FFFFFF), tuyệt đối không trong suốt (iOS và Android yêu cầu bắt buộc)
- Safe zone 76% cho icon maskable trên Android (tránh bị cắt tai bò hay mất chữ Ụm Bò Milk)
- Đầy đủ kích thước: 16x16, 32x32, 48x48 (favicon.ico), 180x180 (apple-touch-icon), 192x192, 512x512
- Sinh cho cả apps/employee-web/public và apps/admin-web/public
"""

import os
import sys

# Ensure UTF-8 stdout on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from PIL import Image

def generate_icons(logo_path, target_dirs):
    if not os.path.exists(logo_path):
        raise FileNotFoundError(f"Không tìm thấy file logo gốc: {logo_path}")

    print(f"Đang đọc logo gốc: {logo_path}...")
    im = Image.open(logo_path).convert("RGB")
    print(f"Kích thước gốc: {im.size}, mode: {im.mode}")

    # 1. 192x192 chuẩn PWA Any
    im_192 = im.resize((192, 192), Image.Resampling.LANCZOS)
    # 2. 512x512 chuẩn PWA Any
    im_512 = im.resize((512, 512), Image.Resampling.LANCZOS)
    # 3. 180x180 Apple Touch Icon (iOS Safari)
    im_180 = im.resize((180, 180), Image.Resampling.LANCZOS)

    # 4. 512x512 Maskable Icon cho Android
    # Safe zone của maskable là hình tròn tâm 80% đường kính -> ta scale logo về 76% (390x390)
    # rồi đặt giữa nền trắng 512x512 để không bị Android cắt xén
    target_size = 390
    im_scaled = im.resize((target_size, target_size), Image.Resampling.LANCZOS)
    maskable_512 = Image.new("RGB", (512, 512), (255, 255, 255))
    offset = ((512 - target_size) // 2, (512 - target_size) // 2)
    maskable_512.paste(im_scaled, offset)

    # 5. Favicon 16x16 và 32x32 PNG
    im_32 = im.resize((32, 32), Image.Resampling.LANCZOS)
    im_16 = im.resize((16, 16), Image.Resampling.LANCZOS)
    im_48 = im.resize((48, 48), Image.Resampling.LANCZOS)

    for target_dir in target_dirs:
        os.makedirs(target_dir, exist_ok=True)
        print(f"==> Xuất icon sang: {target_dir}")

        im_192.save(os.path.join(target_dir, "icon-192.png"), "PNG", optimize=True)
        im_512.save(os.path.join(target_dir, "icon-512.png"), "PNG", optimize=True)
        im_180.save(os.path.join(target_dir, "apple-touch-icon.png"), "PNG", optimize=True)
        im_180.save(os.path.join(target_dir, "apple-touch-icon-precomposed.png"), "PNG", optimize=True)
        maskable_512.save(os.path.join(target_dir, "icon-maskable-512.png"), "PNG", optimize=True)
        im_32.save(os.path.join(target_dir, "favicon-32x32.png"), "PNG", optimize=True)
        im_16.save(os.path.join(target_dir, "favicon-16x16.png"), "PNG", optimize=True)

        # Multi-size ICO (16, 32, 48)
        im_48.save(
            os.path.join(target_dir, "favicon.ico"),
            format="ICO",
            sizes=[(16, 16), (32, 32), (48, 48)],
        )

    print("✓ Đã sinh toàn bộ bộ icon chuẩn PWA & Apple Touch Icon thành công!")

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    logo_file = os.path.join(base_dir, "apps", "employee-web", "public", "logo.jpg")
    dest_dirs = [
        os.path.join(base_dir, "apps", "employee-web", "public"),
        os.path.join(base_dir, "apps", "admin-web", "public"),
    ]
    generate_icons(logo_file, dest_dirs)
