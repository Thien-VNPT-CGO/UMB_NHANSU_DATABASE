# VPS RIENG (nhanh `vps`) — du lieu HOAN TOAN RIENG ban cloud

Nhanh `main` = ban cloud hien tai (Render + Vercel + Sheets cu).
Nhanh `vps` = ban chay tren VPS cua ban (Docker + Nginx + Sheets MOI).
Khong push 2 nhanh cho nhau khi chua muon hop nhat.

Domain: **https://umbomilk-nhansu-diemdanh.duckdns.org/**
(`http` thuong KHONG dung duoc camera/GPS — bat buoc cai HTTPS o buoc 2)

| Duong dan | Noi dung |
|---|---|
| `/` | Cong nhan vien (PWA mobile) |
| `/admin/` | Cong quan tri |
| `/api/` | Backend API + Socket.IO realtime |

## 0. Chuan bi 1 lan

1. Tao 2 Spreadsheet MOI + 1 thu muc Drive MOI cho VPS.
2. Share ca 3 voi email Service Account (quyen Editor) — dung chung
   Service Account voi ban cloud cung duoc, chi can share them.
3. Tro DuckDNS `umbomilk-nhansu-diemdanh` ve IP VPS (trang quan tri DuckDNS).
4. Cai dat tren VPS Ubuntu: `docker`, `docker compose plugin`, `nginx`, `certbot`.

## 1. Clone + cau hinh (tren VPS)

```bash
git clone <repo> ubm-vps && cd ubm-vps
git checkout vps
cp deploy/vps/.env.vps.example apps/backend/.env
nano apps/backend/.env   # dien JWT moi + 2 ID Sheets MOI + ID Drive MOI
```

## 2. Nginx + SSL (BAT BUOC — khong co HTTPS thi NV khong cham cong duoc)

```bash
sudo cp deploy/vps/nginx/ubm.conf /etc/nginx/sites-available/ubm
sudo ln -s /etc/nginx/sites-available/ubm /etc/nginx/sites-enabled/ubm
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d umbomilk-nhansu-diemdanh.duckdns.org
```

## 3. Deploy

```bash
bash deploy/vps/deploy.sh
```

Lan dau backend tu tao du tab Sheets + tai khoan `admin` mac dinh
(doi mat khau ngay trong tab Tai khoan noi bo).

## 4. Cap nhat sau nay (tren VPS)

```bash
cd ubm-vps && bash deploy/vps/deploy.sh
```

## Luu y quan trong

- 2 ban dung Sheets khac nhau nen khong xung dot so lieu.
- Muon dem tinh nang tu `main` sang `vps`: tren may local
  `git checkout vps && git merge main` (giai quyet xung dot neu co).
