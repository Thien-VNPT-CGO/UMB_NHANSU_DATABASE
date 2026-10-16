# HUONG DAN CHI TIET TUNG BUOC — VPS + DuckDNS (nhanh `vps`)

Ket qua cuoi: NV mo `https://umbomilk-nhansu-diemdanh.duckdns.org/`,
Admin mo `https://umbomilk-nhansu-diemdanh.duckdns.org/admin/`.

> Lam tren MAY LOCAL truoc (buoc A), roi lam tren VPS (buoc B→G).
> Uoc tinh: 30–60 phut neu lam lan dau.

## A. Tren GOOGLE (may nao cung duoc)

1. Mo 2 Sheets + 1 Drive da co:
   - Sheet chinh da dien san ID trong `deploy/vps/.env.vps.example`.
2. Lay email Service Account: mo JSON key cua ban, copy `client_email`
   (dang `...@....iam.gserviceaccount.com`). Neu chua co key: Google Cloud
   Console → IAM → Service Accounts → Keys → Create key (JSON).
3. Share voi email do, quyen **Editor**:
   - Sheet 1 → Share → paste email → Editor.
   - Sheet 2 → Share → paste email → Editor.
   - Thu muc Drive → Share → paste email → Editor (de upload anh cham cong).

## B. Tren VPS — mo cong + cai dat (Ubuntu 22.04 tro len)

```bash
# 1. Cap nhat he thong
sudo apt update && sudo apt upgrade -y

# 2. Mo cong tuong lua (SSH + HTTP + HTTPS)
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443
sudo ufw enable   # go yes khi hoi

# 3. Cai Docker (ban chinh thuc)
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
# DANG XUAT SSH ROI DANG NHAP LAI de nhom docker co hieu luc.

# 4. Cai Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# 5. Kiem tra Docker
docker --version && docker compose version
```

## C. Kiem tra DuckDNS tro dung IP VPS

```bash
# Xem IP cua VPS:
curl -4 ifconfig.me
# Xem domain tro ve IP nao (2 IP phai TRUNG nhau):
nslookup umbomilk-nhansu-diemdanh.duckdns.org
```

Neu khac nhau: vao duckdns.org → dang nhap → sua IP → doi 5–10 phut roi
kiem tra lai. Chua dung thi DUNG lam tiep (certbot se that bai).

## D. Clone code + dien bien moi truong

```bash
git clone <repo> ubm-vps && cd ubm-vps
git checkout vps
cp deploy/vps/.env.vps.example apps/backend/.env
nano apps/backend/.env
```

Sua trong `nano` (Ctrl+O → Enter de luu, Ctrl+X de thoat):

| Dong | Dien gi |
|---|---|
| `JWT_SECRET` | Chay `openssl rand -hex 32` tren VPS, paste ket qua vao |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Paste NGUYEN VEN 1 dong JSON key (ghi de len dong mau) |
| `ADMIN_SEED_PASSWORD` | Mat khau admin lan dau (se doi ngay sau khi vao) |
| 3 dong `SPREADSHEET_ID`... | Da dien san — chi doi khi ban muon doi Sheets khac |

Kiem tra JSON con nguyen ven (khong vo dong):
```bash
node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))" < <(grep GOOGLE_SERVICE_ACCOUNT_JSON apps/backend/.env | cut -d= -f2- | tr -d '"') && echo JSON_OK
```
Bao `JSON_OK` thi qua buoc tiep.

## E. Nginx + HTTPS (BAT BUOC — khong co thi NV khong cham cong duoc)

```bash
sudo cp deploy/vps/nginx/ubm.conf /etc/nginx/sites-available/ubm
sudo ln -s /etc/nginx/sites-available/ubm /etc/nginx/sites-enabled/ubm
sudo nginx -t
# Phai bao "syntax is ok" + "test is successful" moi reload:
sudo systemctl reload nginx
sudo certbot --nginx -d umbomilk-nhansu-diemdanh.duckdns.org
# Chon 2 (Redirect) khi certbot hoi co muon chuyen http->https khong.
sudo certbot renew --dry-run   # tu dong gia han: phai PASS
```

## F. Deploy (build + chay)

```bash
cd ~/ubm-vps   # hoac duong dan ban da clone
bash deploy/vps/deploy.sh
```

Script tu lam: build 2 web tro ve API VPS → copy static cho Nginx →
dung backend Docker → goi `/health`. Thay chu `UP` la backend song.

## G. Kiem tra sau deploy (theo thu tu)

1. Tren VPS: `curl http://localhost:4005/health` → thay `"status":"UP"`.
2. Tren may tinh: mo `https://umbomilk-nhansu-diemdanh.duckdns.org/api/health`
   → thay `GOOGLE_SHEETS_LIVE` (nghia la Sheets moi da ket noi).
3. Mo `/admin/` → dang nhap `admin` + `ADMIN_SEED_PASSWORD` → vao tab
   Tai khoan noi bo → DOI MAT KHAU ADMIN NGAY → tao HR/Store/Finance.
4. Mo `/` tren dien thoai (https) → dang nhap SDT + PIN → thu check-in
   (camera + GPS phai xin quyen — neu khong xin quyen la chua co HTTPS).
5. Vao Google Sheets moi: cac tab tu tao + co dong du lieu dau tien.

## Cap nhat sau nay

```bash
cd ~/ubm-vps && bash deploy/vps/deploy.sh
```

## Loi thuong gap

| Loi | Cach sua |
|---|---|
| `SHEETS ... chưa kết nối` / `/health` bao `mode` khac LIVE | Sai JSON key hoac chua share Sheets/Drive cho Service Account (xem lai buoc A) |
| `502 Bad Gateway` | Backend chua chay: `docker compose ps` + `docker compose logs backend --tail 50` |
| Certbot that bai | DNS chua tro dung IP (lam lai buoc C), hoac cong 80 bi chan |
| `docker: permission denied` | Dang xuat SSH roi dang nhap lai (sau `usermod -aG docker`) |
| Trung IP/mang cham | DuckDNS mien phi on dinh vua phai; dung that thi nen domain rieng |
| Quen mat khau admin | Sua `ADMIN_SEED_PASSWORD` khong co tac dung sau lan dau — dung chuc nang doi mat khau trong app |
