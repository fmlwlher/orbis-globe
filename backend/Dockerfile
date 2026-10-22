# ── ORBIS 后端（在线统计服务）────────────────────────────────
# 多阶段构建：先装全量依赖并编译 TS，再只保留生产依赖与 dist
FROM node:22-alpine AS builder
WORKDIR /app

# 显式安装 pnpm：Node 22 镜像里的 corepack 已不带内置签名密钥，
# 直接 `corepack prepare pnpm@10` 会因签名缺失失败，改用 npm 全局安装。
RUN npm install -g pnpm@10

# 先只复制清单文件，利用 Docker 层缓存加速重复构建
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ── 运行阶段 ──────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile \
    && pnpm store prune

COPY --from=builder /app/dist ./dist

# 平台通常通过 PORT 环境变量注入监听端口
ENV PORT=3000
EXPOSE 3000

# 使用非 root 用户运行
USER node

CMD ["node", "dist/index.js"]
