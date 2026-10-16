# VPS RIENG (nhanh `vps`) — du lieu HOAN TOAN RIENG ban cloud

Nhanh `main` = ban cloud hien tai (Render + Vercel + Sheets cu).
Nhanh `vps` = ban chay tren VPS cua ban (Docker + Nginx + Sheets MOI).
Khong push 2 nhanh cho nhau khi chua muon hop nhat.

## 0. Chuan bi 1 lan

1. Tao 2 Spreadsheet MOI + 1 thu muc Drive MOI cho VPS.
2. Share ca 3 voi email Service Account (quyen Editor) — dung chung
   Service Account voi ban cloud cung duoc, chi can share them.
3. Tro 3 ten mien ve IP VPS (vd):
   - `api.ten-mien-cua-ban`
   - `quan-tri.ten-mien-cua-ban`
   - `nhan-vien.ten-mien-cua-ban`
4. Cai dat tren VPS Ubuntu: `docker`, `docker compose plugin`, `nginx`, `certbot`.

## 1. Clone + cau hinh (tren VPS)

```bash
git clone <repo> ubm-vps && cd ubm-vps
git checkout vps
cp deploy/vps/.env.vps.example apps/backend/.env
nano apps/backend/.env   # dien JWT moi + 3 ID Sheets/Drive MOI + CORS dung domain
```

## 2. Nginx + SSL

```bash
# Sua ten mien that trong deploy/vps/nginx/ubm.conf roi:
sudo cp deploy/vps/nginx/ubm.conf /etc/nginx/sites-available/ubm
sudo ln -s /etc/nginx/sites-available/ubm /etc/nginx/sites-enabled/ubm
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.ten-mien-cua-ban -d quan-tri.ten-mien-cua-ban -d nhan-vien.ten-mien-cua-ban
```

## 3. Deploy

```bash
API_DOMAIN=api.ten-mien-cua-ban bash deploy/vps/deploy.sh
```

Lan dau backend tu tao du tab Sheets + tai khoan `admin` mac dinh
(doi mat khau ngay trong tab Tai khoan noi bo).

## 4. Cap nhat sau nay (tren VPS)

```bash
cd ubm-vps && API_DOMAIN=api.ten-mien-cua-ban bash deploy/vps/deploy.sh
```

## Luu y quan trong

- Camera + GPS tren dien thoai DOI HOI HTTPS — khong dung IP tran cho cong nhan vien.
- 2 ban dung Sheets khac nhau nen khong xung dot so lieu.
- Muon dem tinh nang tu `main` sang `vps`: tren may local
  `git checkout vps && git merge main` (giai quyet xung dot neu co).
