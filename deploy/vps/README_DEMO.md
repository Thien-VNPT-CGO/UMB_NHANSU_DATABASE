# Cổng DEMO (test giao diện cho sự kiện) — UBM HR

## Là gì?
2 cổng demo là **bản nhân bản giao diện** của 2 cổng chính thức, dùng để test
giao diện mới (cho các sự kiện) mà **không ảnh hưởng cổng chính thức**:
- `https://umbomilk-nhansu-diemdanh.duckdns.org/demo/` — demo **cổng nhân viên**
- `https://umbomilk-nhansu-diemdanh.duckdns.org/demo-admin/` — demo **cổng quản trị**

Đặc tính:
- **Cùng 1 file nguồn** với cổng chính thức (không có code copy/paste) — demo
  chỉ khác 1 biến biên dịch `VITE_UBM_PORTAL=demo`.
- **Đọc dữ liệu thật** (đăng nhập bằng tài khoản thật) → giao diện đời thực nhất.
- **CHỈ XEM**: mọi thao tác ghi (POST/PUT/PATCH/DELETE trừ /auth/) bị backend
  chặn `403 DEMO_READ_ONLY` — bấm nhầm hủy ca/duyệt phiếu/check-in cũng không
  thể đổi dữ liệu thật. Nhãn nâu "🧪 DEMO — chỉ xem" dính dưới góc màn hình.
- Khách không cần tài khoản riêng; URL công khai nhưng không gắn link nơi khác.

## Quy trình "test giao diện rồi áp dụng qua cổng chính thức"

```
1. Sửa giao diện (RoleViews.tsx / App.tsx / CSS...)
2. commit + push GitHub (nhánh main)
3. Trên VPS:  cd ~/ubm-vps && git pull
              bash deploy/vps/deploy.sh demo     # CHỈ dựng lại 2 cổng DEMO
4. Test giao diện trên /demo/ + /demo-admin/ (dữ liệu thật, chặn ghi)
   - Giao diện 1 hoạt động bình thường ở cổng chính thức.
   - OK rồi → promote: bash deploy/vps/deploy.sh   # bản FULL: chính thức + demo
   - Chưa ưng → sửa code lại, lặp từ bước 2 — cổng chính thức vẫn nguyên.
```

Lưu ý:
- Chế độ `deploy.sh demo` **không build lại backend, không đụng 2 cổng chính thức**
  → triển khai nhanh (~30s), zero rủi ro với người dùng thật.
- `deploy.sh` (không biến) luôn dựng cả bản chính thức lẫn demo cùng lúc là 1
  nguồn — cổng demo không bao giờ lệch code với cổng chính thức khi chạy full.
- Nếu demo báo lỗi 403 `DEMO_READ_ONLY` khi bấm nút — là đúng thiết kế.
- Nginx location của demo có tại `deploy/vps/nginx/ubm.conf`; nếu config trên
  VPS thủ công khác bản mẫu, chạy: `sudo bash deploy/vps/install-demo-nginx.sh`.

## Kiểm tra sau khi cài lần đầu
```bash
curl -I https://umbomilk-nhansu-diemdanh.duckdns.org/demo/           # 200 HTML
curl -I https://umbomilk-nhansu-diemdanh.duckdns.org/demo-admin/     # 200 HTML
# Chặn ghi: phải 401 (vì chưa login) chứ không được 200
curl -X POST https://umbomilk-nhansu-diemdanh.duckdns.org/api/schedules/shifts \
     -H 'X-UBM-PORTAL: demo' -H 'Content-Type: application/json' -d '{}'
```
