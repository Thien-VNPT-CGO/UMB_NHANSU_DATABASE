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
RUN npm ci

# ---------- build: build toàn bộ workspaces ----------
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

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
RUN npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force \
 && rm -rf /tmp/npm-cache

# Output đã build (backend serve static frontend nếu tồn tại)
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/admin-web/dist ./apps/admin-web/dist
COPY --from=build /app/apps/employee-web/dist ./apps/employee-web/dist

RUN chown -R node:node /app
USER node

EXPOSE 4005
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-4005}/health | grep -q '"status":"UP"'

CMD ["node", "apps/backend/dist/server.js"]
