# QUY TRÌNH CẬP NHẬT CODE — CHUẨN ÁP DỤNG (QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN)

> **Người phụ trách đã chốt quy trình này. Mọi lần cập nhật code sau này PHẢI đi theo đúng
> thứ tự dưới đây — không push trực tiếp kênh nào bỏ qua kênh trước.**
> _Cập nhật 2026-10-20: **bỏ môi trường beta** (bỏ chạy song song cổng 4006) — quy trình
> thu gọn còn **4 chặng**; việc thử nghiệm tính năng mới thực hiện trực tiếp trên prod
> trong giờ thấp điểm (tính năng nhập lịch nội bộ, chỉ ADMIN dùng)._

```
Máy IT  ──►  GitHub  ──►  main  ──►  Vps
 (dev)   push   (kho lưu   (staging +  (PRODUCTION
                 trung tâm)  CI kiểm thử) VPS 4005)
```

## Ý nghĩa từng chặng

| Chặng | Nhánh | Vai trò | Hành động |
|---|---|---|---|
| 1 | **Máy IT** | Nơi phát triển + kiểm tra build cục bộ | Build/PASS trước khi push |
| 2 | **GitHub** (`origin`) | Kho lưu trữ trung tâm duy nhất | Commit sạch, push đúng nhánh |
| 3 | **main** (nhánh `main`) | Staging — CI build + smoke test mỗi lần push | Push `origin main` |
| 4 | **Vps** (nhánh `vps`, domain `umbomilk-nhansu-diemdanh.duckdns.org`, cổng **4005**) | Production chạy thật, Sheet chính của VPS | Đẩy `origin HEAD:vps`, sau đó deploy trên VPS:

```bash
bash deploy/vps/deploy.sh   # pull + build web + docker compose up backend + health check
```

## Công cụ tự động hóa (khuyến nghị dùng luôn cho mọi lần cập nhật)

- **Chặng 1→3 (Máy IT → GitHub → main → Vps, mã nguồn)** — chạy MỘT lệnh trong folder dự án:

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\push-chain.ps1 -Message "mô tả thay đổi"
  ```

  Script tự: commit → build kiểm thử → push `main` → merge `main→vps` + build + push → dọn dẹp. Tuỳ chọn: `-SkipBuild` (chỉ thay đổi tài liệu), `-DryRun` (thử nhưng không push). Có xung đột merge thì script dừng và hướng dẫn giải tay.

- **Chặng 4 (deploy trên VPS)** — chọn 1 trong 2 cách để bỏ bước SSH thủ công:

  | Phương án | Cách bật | Đặc điểm |
  |---|---|---|
  | **A. Auto-deploy watcher (khuyến nghị)** | Trên VPS chạy 1 lần: `sudo bash deploy/autodeploy/install-autodeploy.sh` | Cron chạy mỗi phút, tự phát hiện commit mới trên nhánh `vps` rồi deploy prod. Không cần secret nào. Gỡ bỏ: `... install-autodeploy.sh --off`. Log: `/var/log/ubm-autodeploy.log` |
  | **B. GitHub Actions SSH** | Đổi tên `deploy/workflows-template/deploy-vps-ssh.yml.disabled` → `.github/workflows/deploy-vps.yml`, thêm secrets `VPS_HOST/PORT/USER/KEY` trên GitHub | Deploy NGAY khi push. Cần quản lý SSH secret trên GitHub |

## Nguyên tắc bắt buộc

1. **Không bỏ chặng**: code mới bắt đầu từ `main` (staging) trước khi vào `vps` (prod).
2. **Không chép đè cấu hình riêng từng nhánh**: mỗi nhánh có ID Sheets/Drive + mật khẩu seed + domain riêng — merge phải giữ nguyên (`vps`: `Nguyenthanhthien@9999`, Sheet chính của VPS).
3. **Build kiểm thử trước khi push** từng chặng (backend `tsc` + admin/employee web build phải PASS).
4. **Bỏ beta từ 2026-10-20**: khôi phục nhánh beta khi nào thì phải cấp lại domain + cert + Sheet riêng (tham khảo `deploy/beta/` trong lịch sử git).

## Nhãn "BETA" trên chức năng mới (ux mẫu thử)

- Khi ra tính năng mới: thêm 1 dòng vào `BETA_FEATURES` trong `apps/admin-web/src/betaFeatures.tsx` 
  (ví dụ `'hr-schedule': { note: 'Nội dung đang chạy thử...' }`) → chip **BETA** hiện ở sidebar/top-strip 
  và dải banner ám vàng hiện đầu trang khi click vào tab đó.
- Khi tính năng chính thức: **xóa dòng đó** → toàn bộ nhãn BETA tự mất (không phải sửa chỗ khác).

## Lịch sử dẫn chiếu (tham khảo ứng xử đúng)

- Deploy tính năng auto-sync 23 tab (lần đầu): đã đi thẳng IT → `vps` (commit `7c3ea0a`) **trước khi quy trình này được chốt**. Sau này mọi deploy đi theo chuỗi 5 chặng trên.
- Cần "hồi quy" một thay đổi lên đủ chuỗi: push `main` trước, rồi `vps←main` (để 2 nhánh khớp nhau). Nhánh `beta` đã gỡ khỏi quy trình từ 2026-10-20.
