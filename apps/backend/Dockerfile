# UBM HR Backend — all-in-one image (API + serve admin/employee static).
# Build context phải là THƯ MỤC GỐC repo (monorepo workspaces):
#   docker build -f apps/backend/Dockerfile -t ubm-backend .
ARG NODE_VERSION=20.18.0

# ---------- deps: cài dependencies cho toàn monorepo ----------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/admin-web/package.json apps/admin-web/
COPY apps/employee-web/package.json apps/employee-web/
COPY apps/violation-web/package.json apps/violation-web/
RUN npm ci

# ---------- build: dùng dist host (deploy VPS) hoặc build toàn bộ (CI) ----------
FROM deps AS build
ARG USE_HOST_DIST=0
WORKDIR /app
COPY . .
# Deploy VPS: deploy.sh đã build shared + backend + 3 web trên host và truyền
# USE_HOST_DIST=1, nên ở đây chỉ kiểm tra đủ artifact rồi đóng gói — KHÔNG
# build lại (trước đây build trùng tốn ~3-5 phút mỗi lần trên VPS 2 vCPU).
# CI/máy mới: mặc định 0 -> build toàn bộ như cũ.
RUN if [ "$USE_HOST_DIST" = "1" ]; then \
      echo "==> Dung dist build san tu host (bo qua build trong Docker)"; \
      test -f packages/shared/dist/index.js; \
      test -f apps/backend/dist/server.js; \
      test -f apps/admin-web/dist/index.html; \
      test -f apps/employee-web/dist/index.html; \
      test -f apps/violation-web/dist/index.html; \
    else \
      echo "==> Build toan bo workspace trong Docker"; \
      npm run build; \
    fi

# ---------- prod: chỉ prod deps + output đã build ----------
FROM node:${NODE_VERSION}-alpine AS prod
ENV NODE_ENV=production \
    NPM_CONFIG_CACHE=/tmp/npm-cache
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/admin-web/package.json apps/admin-web/
COPY apps/employee-web/package.json apps/employee-web/
COPY apps/violation-web/package.json apps/violation-web/
RUN npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force \
 && rm -rf /tmp/npm-cache

# Output đã build (backend serve static frontend nếu tồn tại)
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
# Tài sản runtime của backend: font PDF phiếu lương (BeVietnam Pro) + logo.
# Không copy thư mục này thì buildPayslipPdf ném PDF_FONT_MISSING trên prod.
COPY --from=build /app/apps/backend/assets ./apps/backend/assets
COPY --from=build /app/apps/admin-web/dist ./apps/admin-web/dist
COPY --from=build /app/apps/employee-web/dist ./apps/employee-web/dist
COPY --from=build /app/apps/violation-web/dist ./apps/violation-web/dist

# KHÔNG chown đệ quy toàn /app: node_modules ~450MB chỉ cần quyền đọc, còn
# `chown -R` từng tốn ~55-63 giây mỗi lần deploy. Chỉ cấp quyền ghi cho đúng
# các thư mục runtime cần ghi (session Zalo, file tạm); /app cấp quyền ghi để
# backend tạo được file ở thư mục làm việc.
RUN chown node:node /app \
 && chown -R node:node /app/apps/backend /app/packages/shared
USER node

EXPOSE 4005
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-4005}/health | grep -q '"status":"UP"'

CMD ["node", "apps/backend/dist/server.js"]
