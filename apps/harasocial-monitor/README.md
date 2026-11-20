# HaraSocial Zalo Alert (HaraSocial Monitor)

Ứng dụng SaaS full-stack giám sát hội thoại khách hàng trên **đa cổng HaraSocial 24/7** và tự động **@tag nhân viên vào nhóm Zalo** khi trễ hạn phản hồi (SLA), đồng thời đồng bộ **ca làm việc** với Web App Quản lý Nhân sự theo thời gian thực.

Ứng dụng chạy **độc lập** với hệ thống UBM HR (database, xác thực và giao diện riêng). Cổng Giám đốc chỉ thêm một tab liên kết/nhúng tới ứng dụng này.

---

## 1. Công nghệ

| Lớp | Công nghệ |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 5, Tailwind CSS v4, lucide-react |
| Backend | Node.js, Express 4, TypeScript, `tsx` (dev) · `esbuild` (production) |
| CSDL | PostgreSQL + Drizzle ORM (`drizzle-kit`), cô lập theo `ownerUid` |
| Xác thực | Firebase Authentication (Google) → `Authorization: Bearer <ID_TOKEN>` xác thực bằng `firebase-admin` |
| Zalo cá nhân | `zca-js` v2 (QR hoặc Cookie + IMEI), tải nhóm/thành viên, gửi @mention nhiều người |
| Realtime | SSE `/api/stream` có Bearer token, client đọc `ReadableStream` |

Dev: Express tích hợp **Vite middleware** và chạy trên **một cổng 3000**.
Production: `vite build` → `dist/client`, `esbuild` → `dist/server/index.js`, Express phục vụ SPA + API.

---

## 2. Chạy nhanh

```bash
# 1) Cài dependency (từ root monorepo)
npm install

# 2) Tạo file môi trường
cp apps/harasocial-monitor/.env.example apps/harasocial-monitor/.env
#    rồi điền DATABASE_URL + Firebase (hoặc HARA_DEV_UID khi dev)

# 3) Tạo bảng PostgreSQL
npm run db:migrate --workspace=@ubm/harasocial-monitor

# 4) Chạy dev (http://localhost:3000)
npm run dev --workspace=@ubm/harasocial-monitor
```

Chạy test logic thuần:

```bash
npm test --workspace=@ubm/harasocial-monitor
# 60 test với node:test (tsx --test)
```

Build production:

```bash
npm run build --workspace=@ubm/harasocial-monitor
NODE_ENV=production node apps/harasocial-monitor/dist/server/index.js
```

> Máy chủ **vẫn khởi động** khi chưa cấu hình DB/Firebase: các API trả `503` kèm hướng dẫn thay vì crash.

### 2.1 Triển khai VPS (cùng domain UBM, đường dẫn `/harasocial/`)

```bash
# Trên VPS, trong repo /ubm-vps
cd /ubm-vps
bash deploy/vps/deploy.sh
```

Script deploy sẽ tự động:

1. Build SPA với `VITE_BASE_PATH=/harasocial/` và `VITE_API_BASE=/harasocial`.
2. Tạo PostgreSQL role/database `harasocial` (idempotent), sinh `apps/harasocial-monitor/.env`.
3. Áp `drizzle/0000_init.sql`.
4. Cài systemd `harasocial-monitor.service` (cổng nội bộ `3010`).
5. Thêm Nginx `location /harasocial/` (tắt proxy buffering để SSE realtime) và reload.
6. Kiểm tra `http://127.0.0.1:3010/api/health`.
7. Tự bật HR webhook và ghi `HR_SCHEDULE_WEBHOOK_URL/SECRET` vào `apps/backend/.env` rồi restart container backend — nhờ vậy mọi lần lưu ca trong UBM HR sẽ đẩy lịch sang HaraSocial ngay.

Kết quả: `https://umbomilk-nhansu-diemdanh.duckdns.org/harasocial/`

Cuối log deploy in ra **mã truy cập quản trị** (`HARA_ACCESS_CODE`). Mã này chỉ in một lần đầu; các lần deploy sau giữ nguyên. Xem lại trong `/ubm-vps/apps/harasocial-monitor/.env`.

Nếu muốn bật đăng nhập Google qua Firebase sau này: điền `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_WEB_APP_ID` vào file `.env` trên VPS rồi `systemctl restart harasocial-monitor`.

---

## 3. Biến môi trường

Xem `apps/harasocial-monitor/.env.example`. Tóm tắt:

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `DATABASE_URL` | Có | Chuỗi kết nối PostgreSQL |
| `PORT` | Không | Mặc định `3000` |
| `PUBLIC_URL` | Khuyến nghị khi deploy | Dùng để sinh URL webhook chính xác |
| `FIREBASE_SERVICE_ACCOUNT_JSON` / `_BASE64` | Có (production) | Service account để verify ID token |
| `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_WEB_APP_ID` | Có | Firebase Web SDK cho đăng nhập Google |
| `HARA_DEV_UID` | Không | Chỉ dev: đăng nhập không cần Firebase (bị bỏ qua khi `NODE_ENV=production`) |
| `HARA_ACCESS_CODE` | Khuyến nghị | Mã truy cập quản trị (đăng nhập khi chưa bật Firebase) |
| `HARA_SESSION_SECRET` | Khuyến nghị | Secret ký phiên đăng nhập HMAC 30 ngày |
| `HARA_OWNER_UID` / `_EMAIL` / `_NAME` | Không | Chủ sở hữu dữ liệu khi đăng nhập bằng mã truy cập |
| `GOOGLE_OAUTH_CLIENT_ID` | Không | Google Identity Services (nút đăng nhập Google) |
| `HARA_ALLOWED_EMAILS` | Không | Danh sách email Google được phép, cách nhau bằng dấu phẩy |
| `ALLOW_INSECURE_PULL` | Không | `1` = cho phép HTTP/localhost khi dev (mặc định chặn SSRF) |
| `HARA_WORKER_DISABLED` | Không | `1` = tắt worker SLA |

---

## 4. Mô hình dữ liệu

Tất cả bảng đều scope theo `ownerUid` (Firebase UID):

- `users` — `uid`, `email`, `display_name`.
- `workspace_configs` — cấu hình Zalo, phiên Zalo cá nhân, danh sách cổng (`channels` jsonb), cấu hình HR, secret webhook, ngưỡng SLA, chu kỳ nhắc, bật/tắt worker.
- `sales_staff` — nhân viên sale: `zaloUserId`, `zaloTag`, `shift`, `active`, `monitorChannelIds` (mảng rỗng = tất cả cổng), `externalHrId`, `email`.
- `harasocial_conversations` — hội thoại thật theo cổng, trạng thái `waiting | missed | replied`, `alertCount`, `alertSentForCurrentTurn`.
- `notification_logs` — nhật ký mọi lần gửi Zalo (`live_api`) hoặc chỉ ghi log (`sandbox_log`).

Migration SQL: `apps/harasocial-monitor/drizzle/0000_init.sql`.

---

## 5. Nghiệp vụ cốt lõi

### 5.1 Nhận dữ liệu HaraSocial (2 kênh song song)

1. **Webhook thời gian thực**
   ```
   POST/GET/OPTIONS /api/webhooks/harasocial?workspace=<ownerUid>&channelKey=<key>
   Header: x-harasocial-secret: <workspace.harasocialWebhookSecret>
   ```
   Hỗ trợ payload phẳng, `data.conversations`, mảng trực tiếp; tự nhận diện tin của khách vs. page/nhân viên.

2. **API kéo 24/7** — mỗi cổng cấu hình `harasocialApiUrl` + `harasocialAccessToken` (+ `harasocialPageId`).
   Worker kéo song song mọi cổng bằng `Promise.allSettled`; **một cổng lỗi không ảnh hưởng cổng khác**.
   URL bắt buộc HTTPS công khai, chặn localhost/IP nội bộ/metadata (chống SSRF, kiểm tra cả DNS resolve).

Mỗi cổng gắn **nhiều nhóm Zalo** (`zaloGroups[]`); cảnh báo của cổng gửi tới **tất cả** nhóm của cổng đó.

### 5.2 SLA & nhắc lặp (worker 30 giây)

- Hội thoại có tin cuối từ khách và chưa trả lời:
  - Chờ ≥ ngưỡng SLA (mặc định **5 phút**) → gửi cảnh báo lần 1, đánh dấu `missed`, `alertCount = 1`.
  - Sau mốc SLA, cứ mỗi **2 phút** (chọn 1/2/3/5/10 hoặc tắt) gửi `[NHẮC LẠI LẦN N...]`.
  - Nhân viên trả lời (hoặc bấm “Đã trả lời”) → reset `alertCount = 0`, dừng nhắc.
- Chống bắn trùng: khoảng cách tối thiểu giữa 2 lần nhắc = chu kỳ cấu hình.
- Ngưỡng SLA có thể đặt chung và ghi đè riêng từng cổng.

### 5.3 Ca trực & chọn người @tag

- Tính giờ theo **UTC+7 cố định**, hỗ trợ `HH:MM - HH:MM`, `8h00-17h30`, `HH:MM:SS`, nhiều ca và **ca qua đêm** (`22:00 - 06:00`).
- Chỉ xét nhân viên: đang bật + đúng phạm vi cổng (`monitorChannelIds`) + đang trong ca.
- Ưu tiên người được gán; nếu hết ca → điều hướng sang người đang trực của cổng; tùy chọn tag toàn bộ người đang trực.
- `zaloUserId` chỉ tạo metadata mention khi là **UID số ≥ 6 chữ số**; vị trí `(pos, len)` tính đúng theo UTF-16.

### 5.4 Bốn phương thức gửi Zalo

| Mode | Mô tả |
| --- | --- |
| `personal` | Zalo cá nhân qua `zca-js` — gửi vào nhóm kèm mentions thật |
| `webhook` | POST JSON tới Make/n8n: `groupId`, `groupName`, `taggedStaff`, `title`, `message`, `text`, `category` |
| `oa_group` | Zalo OA Nhóm — GMF v3.0 |
| `oa_user` | Zalo OA 1-1 cho từng nhân viên có UID hợp lệ |

Phản hồi Zalo OpenAPI được kiểm tra **cả HTTP status và `error !== 0`** (Zalo có thể trả HTTP 200 nhưng lỗi nghiệp vụ).

---

## 6. Tích hợp Web App Quản lý Nhân sự

```
GET/POST/OPTIONS /api/webhooks/hr?workspace=<ownerUid>
Header (tùy chọn): x-hr-secret: <workspace.hr.webhookSecret>
CORS: mở (cho phép gọi trực tiếp từ SPA/backend khác)
```

Payload chấp nhận:

- Một nhân viên hoặc mảng trong `employees`, `shifts`, `schedules`, `items`, hoặc mảng trực tiếp.
- Ca dạng `startTime`/`endTime` hoặc chuỗi `shift`.
- Trạng thái nghỉ: `active: false`, `isOff`, `status: off | leave | nghi_phep…`.

Khớp nhân viên theo thứ tự: **`staffId` → `externalHrId` → `email` → `zaloUserId` → tên tiếng Việt** (bỏ dấu, giữ nguyên tên có dấu chuẩn khi trùng).

Đồng bộ **chỉ** cập nhật `shift`, `active`, `externalHrId`, `email` — **không ghi đè** `zaloUserId`, `zaloTag`, cổng phụ trách. Sau khi ghi DB, server bắn SSE `hr` tới mọi trình duyệt đang mở (< 1 giây).

Dự phòng: cấu hình `hr.apiUrl` + `hr.apiToken` và bấm “Kéo dữ liệu HR ngay” (hoặc worker kéo định kỳ 5 phút).

Ví dụ gọi từ app nhân sự:

```js
await fetch('https://harasocial.ubm.vn/api/webhooks/hr?workspace=<uid>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-hr-secret': '<secret>' },
  body: JSON.stringify({
    employees: [{ staffId: 'UBM001', name: 'Nguyễn Văn A', email: 'a@ubm.vn', shift: '08:00 - 17:30', active: true }],
  }),
});
```

---

## 7. API chính (đều cần Bearer token)

| Endpoint | Chức năng |
| --- | --- |
| `GET /api/bootstrap` | Toàn bộ dữ liệu khởi tạo + URL webhook + trạng thái worker |
| `PATCH /api/workspace` | Lưu Zalo/channels/HR/SLA/chu kỳ nhắc/worker |
| `POST /api/workspace/secret` | Tạo lại secret HaraSocial hoặc HR |
| `GET/POST/PATCH/DELETE /api/staff…` | CRUD nhân viên sale |
| `GET /api/conversations`, `POST /api/conversations/reply` | Danh sách & đánh dấu đã trả lời |
| `POST /api/conversations/alert` | Gửi cảnh báo Zalo ngay cho 1 hội thoại |
| `POST /api/sync/harasocial`, `POST /api/sla/run` | Đồng bộ & quét SLA thủ công |
| `POST /api/hr/pull`, `GET /api/logs` | Kéo HR dự phòng, nhật ký cảnh báo |
| `POST /api/channels/test` | Test gửi 1 nhóm của cổng |
| `GET /api/zalo/personal/status`, `POST /api/zalo/personal/qr`, `POST /api/zalo/personal/cookie` | Kết nối Zalo cá nhân |
| `GET /api/zalo/groups`, `GET /api/zalo/groups/:id/members` | Danh sách nhóm & thành viên |
| `GET /api/stream` | SSE realtime (Bearer) |

---

## 8. Cấu trúc thư mục

```
apps/harasocial-monitor/
├─ server/
│  ├─ index.ts              # Express + Vite middleware / static SPA
│  ├─ auth.ts               # Firebase Admin + dev fallback
│  ├─ env.ts                # đọc .env, cờ cấu hình
│  ├─ db/{schema,client,repo}.ts
│  ├─ routes/{api,webhooks,zalo,helpers}.ts
│  └─ services/{events,sla-service,zalo-sender,zalo-personal,pull-service,hr-sync-service,worker}.ts
├─ shared/                  # logic thuần dùng chung server + client + test
│  ├─ time.ts staff.ts sla.ts alert-text.ts harasocial.ts hr-sync.ts zalo-payload.ts net.ts
├─ src/                     # React SPA
│  ├─ App.tsx
│  ├─ components/{LoginScreen,MonitorTab,ui}.tsx
│  ├─ components/settings/*
│  └─ lib/{api,firebase,format}.ts
├─ test/*.test.ts           # node:test
├─ drizzle/0000_init.sql
└─ drizzle.config.ts
```

---

## 9. Ghi chú an toàn

- Dữ liệu **cô lập 100% theo `ownerUid`**; mọi truy vấn đều kèm điều kiện owner.
- Webhook công khai được bảo vệ bằng secret so sánh `timingSafeEqual`; có thể để trống nhưng không khuyến nghị.
- SSE yêu cầu Bearer token, không dùng query token (trừ dev).
- URL API kéo và webhook gửi đi đều qua `assertSafeHttpUrl` (HTTPS, chặn IP nội bộ, metadata, credentials) + kiểm tra DNS.
- Không có dữ liệu giả lập: mọi hội thoại/cảnh báo đều đến từ webhook/API thật.
