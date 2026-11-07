# Triển khai kiến trúc 5 Cổng - VPS - Postgres + Redis + Backup Sheet/Drive (P0-P3)

> Triển khai theo file gốc `VPS_DataBase_Sheet.md` (Prompt 2). Mọi thứ đều **backward compatible**:
> chưa có Redis vẫn chạy được (fallback poll 30s), chưa bật `GOOGLE_SHEETS_EXPORT=1` thì
> Worker chỉ ghi log, không ghi đè Sheet chính.

## P0 — Hạ tầng

| Hạng mục | File |
|---|---|
| `redis:7-alpine` + volume `redis-data` + healthcheck `redis-cli ping` | `docker-compose.yml` |
| `bullmq + ioredis` | `apps/backend/package.json` |
| Cấu hình Redis (URL/host/password) | `apps/backend/src/config/redis.ts` |
| Queue `sheets-sync` / `drive-sync` (BullMQ) | `apps/backend/src/queue/queue.ts` |
| Schema tham khảo 5 roles + sync fields | `apps/backend/prisma/schema.prisma` |
| Biến môi trường | `apps/backend/.env.example` |

**Deploy VPS:**

```bash
docker compose up -d --build postgres redis backend
docker compose ps
curl http://localhost:4005/health/ready   # cần "redis.configured": true khi đã set REDIS_URL
```

## P1 — Outbox + Worker Postgres -> Sheet/Drive

**Luồng:**
```
API (POST/PUT) -> PostgresStore.persistMutation (ghi DB trước) -> PostgresAdapter.executeWrite
  -> enqueueSyncOutbox (sync_outbox PENDING) -> enqueue BullMQ
  -> Worker sheets-sync/drive-sync (batch) -> Google Sheets API / Drive API
  -> mark SYNCED (hoặc FAILED sau 5 lần retry, không ghi đè DB)
Chưa có Redis: server.ts poll outbox mỗi SYNC_OUTBOX_POLL_MS (mặc định 30s) gom batch 100 dòng.
```

| Hạng mục | File |
|---|---|
| Bảng `sync_outbox` + index | `apps/backend/src/repositories/postgres-store.ts` (`initSchema` + `enqueueSyncOutbox/claimPendingOutbox/mark*`) |
| Hook sau mỗi write | `apps/backend/src/repositories/postgres.adapter.ts` (`executeWrite`) |
| Export + poll fallback | `apps/backend/src/services/sheets-export.service.ts` |
| BullMQ Workers | `apps/backend/src/workers/outbox.worker.ts` |
| Scheduler 30s trong server | `apps/backend/src/server.ts` |

**Lưu ý:**
* Bật ghi Sheet thật (mặc định TẮT để an toàn): `GOOGLE_SHEETS_EXPORT=1` trong `.env` backend.
* Ảnh `DRV_LOCAL` sẽ được Drive worker upload nền; không chặn điểm danh (có `DRIVE_UPLOAD_BLOCK_MS` để chờ tối đa nếu cần).

**Kiểm tra nhanh:**
```
POST /api/... (ghi dữ liệu) -> GET /admin/sync/outbox/status (cần role ADMIN/HR)
-> outbox chuyển SYNCED sau <=30s (chưa có Redis) hoặc ngay khi có Redis.
```

## P2 — Backup SQL + Restore API (Disaster Recovery)

| Hạng mục | File |
|---|---|
| Backup `pg_dump | gzip` + rclone Drive | `deploy/vps/backup-sql.sh` (cron 02:00 VN) |
| Restore JSONL.gz (tự động trong API) | `apps/backend/src/services/restore.service.ts` |
| Delta Sync Sheet -> DB theo `id + updated_at` | cùng file trên |
| Route Admin | `POST /admin/backup/restore` + `POST /admin/sync/sheets/delta` + `GET /admin/sync/outbox/status` |

**Cron VPS:**

```bash
0 2 * * * cd /opt/ubm && bash deploy/vps/backup-sql.sh >> data/backups/sql.log 2>&1
```

**Restore JSONL.gz qua API (ADMIN):**

```jsonc
POST /admin/backup/restore
{ "confirm": "RESTORE", "filename": "postgres_2026-11-07.jsonl.gz", "contentBase64": "<base64 của .jsonl.gz>" }
```
* API luôn tạo bản `data/backups/pre-restore/pre_restore_*.jsonl.gz` trước khi restore.
* File `.sql.gz` sẽ trả `409 SQL_RESTORE_NEEDS_PSQL` — áp dụng bằng `psql` trên VPS, không shell-out trong Node.

## P3 — Vận hành & nghiệm thu

```bash
# 1) Docker up toàn bộ
docker compose up -d --build
docker compose ps
docker compose logs -f backend | grep -E "sheets-export|backup|postgres"

# 2) Kiểm tra health
curl http://localhost:4005/health
curl http://localhost:4005/health/ready

# 3) Test suite
npm run test --workspace=@ubm/backend   # 198 tests phải pass

# 4) Backup tay
curl -X POST http://localhost:4005/admin/backups/run -H "Authorization: Bearer <ADMIN>" -H "Content-Type: application/json" -d '{"kind":"daily"}'
```

**Rollback:**
* Tắt Redis: xóa `REDIS_URL` khỏi env -> backend tự fallback poll, không cần code lại.
* Tắt Sheet export: `GOOGLE_SHEETS_EXPORT=0` -> Worker chỉ ghi log.
* Rollback DATA_STORE: đặt `DATA_STORE=sheets` và restart để revert sang Sheets live (dữ liệu Sheets còn nguyên).

## Ma trận phân quyền 5 cổng (khớp RBAC hiện có)

| Cổng tài liệu | Role code hiện tại | Quyền chính |
|---|---|---|
| Giám đốc | `DIRECTOR` | Duyệt & báo cáo, xem tổng quan, restore |
| Kế toán | `FINANCE` (tài liệu gọi ACCOUNTANT) | Thu/chi, công nợ, lương, đối soát |
| Admin | `ADMIN` | Toàn quyền, cấu hình, backup/restore, delta sync |
| HR | `HR` | Nhân sự, chấm công, phỏng vấn, duyệt phiếu |
| Nhân viên | `EMPLOYEE` | Tác nghiệp, gửi đơn, điểm danh, xem lương |

## Sơ đồ Mermaid (theo Prompt 3)

```mermaid
flowchart TB
    subgraph PORTALS["5 CỔNG (WEB APPS)"]
        GD["Giám đốc (DIRECTOR)"]
        KT["Kế toán (FINANCE)"]
        AD["Admin"]
        HR["HR"]
        NV["Nhân viên"]
    end
    VPS["VPS - Express + Socket.IO + RBAC<br/>Background Worker (BullMQ)"]
    DB[("PostgreSQL 16 + Redis 7<br/>Master DB - sync_outbox")]
    SHEET["Google Sheet<br/>Export một chiều"]
    DRIVE["Google Drive<br/>JSONL.gz + SQL.gz + Ảnh"]

    GD <-->|Realtime| VPS
    KT <-->|Realtime| VPS
    AD <-->|Realtime| VPS
    HR <-->|Realtime| VPS
    NV <-->|Realtime| VPS
    VPS <-->|Đọc/Ghi trực tiếp| DB
    DB -->|Outbox -> Worker| SHEET
    DB -->|Backup 4 tầng + pg_dump| DRIVE
    DRIVE -.->|Restore ADMIN| DB
    SHEET -.->|Delta Sync (id+updated_at)| DB
```
