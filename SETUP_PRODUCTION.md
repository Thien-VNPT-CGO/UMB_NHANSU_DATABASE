# HUONG DAN TRIEN KHAI DU LIEU THAT - V5.1

## Buoc 1: Kiem tra ket noi

Sau khi deploy, goi API:
GET https://<render-url>/health

Ket qua mong doi:
{
  status: UP
  sheetsStatus.connected: true
  sheetsStatus.mode: GOOGLE_SHEETS_LIVE
}

## Buoc 2: Bien moi truong tren Render.com

| Bien | Gia tri |
|------|---------|
| GOOGLE_SERVICE_ACCOUNT_JSON | Noi dung JSON Service Account key |
| SPREADSHEET_ID | 17iXM0zc1m17aX9AZrFMjOkPRMy2_CwWfjTRZSUPQF2w |
| CANDIDATE_SPREADSHEET_ID | 1rcqEKraSRhr-Tn9qwlhADlkQUei8j65bXeHF_Tmkd38 |
| GOOGLE_DRIVE_FOLDER_ID | ID thu muc Drive |
| JWT_SECRET | Chuoi bi mat manh (openssl rand -hex 32) |

## Buoc 3: Quyen Service Account

Vao Google Sheets -> Chia se -> Them email Service Account voi quyen Editor
Vao Google Drive Folder -> Them email Service Account voi quyen Editor

## Buoc 4: Cau truc Google Sheets tu dong tao

Server se TAO 12 TAB khi khoi dong lan dau (chi tab he thong can, da xoa tab mirror HR_* / CHI_TIET_LUONG / CAU_HINH_HE_THONG):
NHAN_VIEN_MASTER, TAI_KHOAN_NHAN_VIEN, ADMIN_ACCOUNTS, PHAN_CONG_CA
SU_KIEN_DIEM_DANH, DON_NGHI_PHEP, DON_DOI_CA, DIEU_CHINH_CONG
KY_LUONG, AUDIT_LOG, DANH_SACH_CHI_NHANH, FROM_NHAN_VIEN

Luu y: neu Sheets cu van con cac tab HR_UNG_VIEN, HR_THU_VIEC, HR_CHINH_THUC,
HR_LICH_TUAN, HR_CHAM_CONG, HR_CHUYEN_CHINH_THUC, HR_TINH_LUONG, CHI_TIET_LUONG,
CAU_HINH_HE_THONG -> xoa tay tren Google Sheets (code khong tu xoa tab de tranh mat du lieu).

## Buoc 5: Tai khoan admin bootstrap

Tai khoan mac dinh (khi ADMIN_ACCOUNTS chua co du lieu tren Sheets):
Username: admin
Password: Master@@2027

Sau khi dang nhap lan dau:
1. Vao Tab 'Tai khoan noi bo'
2. Tao tai khoan HR/Store/Finance voi mat khau rieng
3. Doi mat khau admin neu muon

## Buoc 5b: Cap ma PIN dang nhap cho nhan vien (SĐT + PIN)

1. HR vao tab Kich hoat tai khoan -> nut "🔑 Cấp PIN" -> nhap 4-8 chu so -> trao TRUC TIEP cho nhan vien
2. Nhan vien dang nhap bang SĐT + PIN, bat buoc doi PIN moi o lan dau (API khac bi 403 PIN_CHANGE_REQUIRED den khi doi xong)
3. Tai khoan cu chua co cot PIN -> bao PIN_NOT_SET, HR cap PIN la xong (Sheets tu them 2 cot: Ma PIN hash + Bat buoc doi PIN)

## Buoc 6: Quy trinh them nhan vien that

1. Admin them nhan vien: POST /employees
2. Nhan vien xuat hien trong Sheets tab NHAN_VIEN_MASTER
3. Admin kich hoat tai khoan: POST /admin/employee-accounts/:id/activate
4. Nhan vien dang nhap bang SDT: POST /auth/employee/phone-login

## Buoc 7: Realtime Flow

Nhan vien cham cong (check-in/out)
-> POST /attendance/events
-> Ghi vao Sheets tab SU_KIEN_DIEM_DANH
-> Upload anh len Google Drive
-> Phat Socket.IO -> Admin/Store nhan thong bao realtime

## Kiem tra nhanh sau deploy

POST /auth/admin/login { username: 'admin', password: 'Master@@2027' }
GET /admin/integrations/status (kiem tra ket noi Sheets)
POST /admin/integrations/pull-now (tai du lieu tu Sheets ngay)
GET /admin/dashboard/stats (kiem tra dashboard)

## Buoc 8: CI tu dong (.github/workflows/ci.yml)

Moi push / pull request deu chay tren GitHub Actions (Node 20.18.0):
1. `npm ci` -> `npm run build` (shared + backend + admin-web + employee-web)
2. `docker build` image backend + smoke test GET /health == UP

## Buoc 9: Chay bang Docker (thay the Render native)

1. Copy `apps/backend/.env.example` -> `apps/backend/.env`, dien gia tri that
2. `docker compose up --build -d`
3. Kiem tra: `curl http://localhost:4005/health` -> `{"status":"UP",...}`
4. Image all-in-one: backend serve luon admin-web + employee-web dist
   (xem `apps/backend/Dockerfile`, context build la thu muc goc repo)

Bien moi truong bo sung (xem `apps/backend/.env.example`):
CORS_ORIGINS, AUTH_RATE_LIMIT_MAX, GENERAL_RATE_LIMIT_MAX,
JWT_ACCESS_TTL, JWT_REFRESH_TTL, ADMIN_SEED_PASSWORD

