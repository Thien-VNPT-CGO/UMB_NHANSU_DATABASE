# QUY TRÌNH CẬP NHẬT CODE — CHUẨN ÁP DỤNG (QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN)

> **Người phụ trách đã chốt quy trình này. Mọi lần cập nhật code sau này PHẢI đi theo đúng
> thứ tự dưới đây — không push trực tiếp kênh nào bỏ qua kênh trước.**

```
Máy IT  ──►  GitHub  ──►  Beta  ──►  main  ──►  Vps
 (dev)   push   (kho lưu  (môi trường  (staging +   (PRODUCTION
                 trung tâm)  thử nghiệm)  CI kiểm thử)  VPS 4005)
```

## Ý nghĩa từng chặng

| Chặng | Nhánh | Vai trò | Hành động |
|---|---|---|---|
| 1 | **Máy IT** | Nơi phát triển + kiểm tra build cục bộ | Build/PASS trước khi push |
| 2 | **GitHub** (`origin`) | Kho lưu trữ trung tâm duy nhất | Commit sạch, push đúng nhánh |
| 3 | **Beta** (nhánh `beta`, domain `umbomilk-beta.duckdns.org`, cổng **4006**) | Môi trường thử nghiệm, Sheet + Drive **riêng** — tính năng mới chạy thử tại đây trước | Merge code mới vào `beta` → phân phối lên beta trên VPS |
| 4 | **main** (nhánh `main`) | Staging — CI build + smoke test mỗi lần push | Merge `beta` → `main`, push `origin main_` |
| 5 | **Vps** (nhánh `vps`, domain `umbomilk-nhansu-diemdanh.duckdns.org`, cổng **4005**) | Production chạy thật, Sheet chính của VPS | Đẩy `origin commit_:vps`, sau đó SSH trên VPS chạy:

```bash
bash deploy/vps/deploy.sh   # pull + build web + docker compose up backend + health check
```

## Công cụ tự động hóa (khuyến nghị dùng luôn cho mọi lần cập nhật)

- **Chặng 1→4 (Máy IT → GitHub → Beta → main → Vps, mã nguồn)** — chạy MỘT lệnh trong folder dự án:

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\push-chain.ps1 -Message "mô tả thay đổi"
  ```

  Script tự: commit → build kiểm thử → merge `main→beta` + build + push → ff `main` + push → merge `main→vps` + build + push → dọn dẹp. Tuỳ chọn: `-SkipBuild` (chỉ thay đổi tài liệu), `-DryRun` (thử như v`ermenkhi, không push). Có xung đột merge thì script dừng và hướng dẫn giải tay.

- **Chặng 5 (deploy trên VPS)** — chọn 1 trong 2 cách để bỏ bước SSH thủ công:

  | Phương án | Cách bật | Đặc điểm |
  |---|---|---|
  | **A. Auto-deploy watcher (khuyến nghị)** | Trên VPS chạy 1 lần: `sudo bash deploy/autodeploy/install-autodeploy.sh` | Cron chạy mỗi phút, tự phát hiện commit mới trên nhánh `vps`/`beta` rồi deploy tương ứng. Không cần secret nào. Gỡ bỏ: `... install-autodeploy.sh --off`. Log: `/var/log/ubm-autodeploy.log` |
  | **B. GitHub Actions SSH** | Đổi tên `deploy/workflows-template/deploy-vps-ssh.yml.disabled` → `.github/workflows/deploy-vps.yml`, thêm secrets `VPS_HOST/PORT/USER/KEY` trên GitHub | Deploy NGAY khi push. Cần quản lý SSH secret trên GitHub |



1. **Không bỏ chặng**: code mới luôn bắt đầu từ `beta` trước khi vào `main`, chỉ vào `vps` khi đã ổn ở `beta` + `main`.
2. **Không chép đè cấu hình riêng từng nhánh**: mỗi nhánh có ID Sheets/Drive + mật khẩu seed + domain riêng — merge phải giữ nguyên các giá trị đặc thù (vps: `Nguyenthanhthien@9999`, Sheet chính vps; beta: Sheet beta...).
3. **Build kiểm thử trước khi push** từng chặng (backend `tsc` + admin/employee web build phải PASS).
4. **Dữ liệu 3 môi trường độc lập** — không đồng bộ/GD Sheet chớng chéo.

## Lịch sử dẫn chiếu (tham khảo ứng xử đúng)

- Deploy tính năng auto-sync 23 tab (lần đầu): đã đi thẳng IT → `vps` (commit `7c3ea0a`) **trước khi quy trình này được chốt**. Sau này mọi deploy đi theo chuỗi 5 chặng trên.
- Cần "hồi quy" một thay đổi lên đủ chuỗi: merge vào `beta` trước, rồi `main←beta`, rồi `vps←main` (vps nhanh hiện đã có thay đổi riêng nhưng nên hợp nhất lại theo chuỗi để 3 nhánh đều khớp).
