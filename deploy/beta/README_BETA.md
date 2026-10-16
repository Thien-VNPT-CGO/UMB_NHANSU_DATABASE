# BAN BETA (nhanh `beta`) — thu nghiem tinh nang truoc khi day vao ban chinh

Quy trinh: code moi tren `main` → gop vao `beta` → test tren
`umbomilk-beta.duckdns.org` → on thi gop `beta` vao `vps` (ban chinh).

```bash
# May local: dua tinh nang moi sang beta
git checkout beta && git merge main
git push origin beta
# Test OK thi dua vao ban chinh:
git checkout vps && git merge beta
git push origin vps
```

## Dung 1 lan tren VPS (da co san Docker/Nginx tu ban chinh)

1. Tao hostname moi tren duckdns.org: `umbomilk-beta` → tro ve IP VPS
   (neu muon ten khac thi sua trong `deploy/beta/*`).
2. Tao 2 Spreadsheet MOI + 1 thu muc Drive MOI cho beta, share Editor
   cho email Service Account (TUYET DOI khong dung chung Sheets ban chinh
   keo du lieu test lam ban san xuat).
3. Cai dat:
```bash
git clone <repo> ~/ubm-beta && cd ~/ubm-beta
git checkout beta
cp deploy/beta/.env.beta.example apps/backend/.env
nano apps/backend/.env   # JWT moi + JSON key + 3 ID MOI cua beta
sudo cp deploy/beta/nginx/ubm-beta.conf /etc/nginx/sites-available/ubm-beta
sudo ln -s /etc/nginx/sites-available/ubm-beta /etc/nginx/sites-enabled/ubm-beta
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d umbomilk-beta.duckdns.org   # chon 2 Redirect
bash deploy/beta/deploy-beta.sh
```
4. Cap nhat beta sau nay: `cd ~/ubm-beta && bash deploy/beta/deploy-beta.sh`
