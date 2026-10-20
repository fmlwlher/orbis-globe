# 部署指南

本项目包含两部分，部署方式不同：

| 部分 | 内容 | 部署位置 | 是否必需 |
| --- | --- | --- | --- |
| 前端 | React + Three.js 三维地球仪 | **GitHub Pages**（静态托管） | 必需 |
| 后端 | 在线用户统计（WebSocket 实时推送） | **Cloudflare Workers**（首选）/ Render（备选） | 可选 |

> GitHub Pages 只能托管静态文件，**无法运行 Node 服务**。因此在线人数统计需要单独部署后端；
> 未部署后端时，前端会以「离线演示」模式运行，页面其余功能完全不受影响。

两个后端实现接口完全一致，任选其一即可：

- `worker/` —— **Cloudflare Workers + Durable Objects**（推荐：永不休眠、免费额度充足）
- `backend/` —— Express 版（可部署到 Render / Railway / 任意 VPS）

---

## 一、前端：GitHub Pages（自动）

推送到 `main` 分支即自动构建发布，工作流见 `.github/workflows/deploy-pages.yml`。

- 站点地址：<https://fmlwlher.github.io/orbis-globe/>
- 单文件离线版：<https://fmlwlher.github.io/orbis-globe/globe.html>

工作流会自动：
1. `pnpm install` + `tsc` 类型检查 + `vite build`
2. 从 `GITHUB_REPOSITORY` 推导 `base` 子路径（`/orbis-globe/`）
3. 附加 `globe.html`、写入 `.nojekyll`

**首次部署需在仓库设置里开启 Pages**：Settings → Pages → Source 选择 **GitHub Actions**。

---

## 二、后端：在线统计服务

### 方式 A：Cloudflare Workers（推荐）

**优势**：永不休眠（打开页面即有人数，无需等待冷启动）、免费额度 10 万请求/天、
全球边缘节点、使用 WebSocket Hibernation 时空闲连接不产生时长费用。

#### 首次部署（命令行，约 1 分钟）

```bash
cd worker
pnpm install

# 登录（浏览器授权）
npx wrangler login

# 部署
pnpm deploy
```

部署成功后会输出地址，形如：

```
https://orbis-presence-api.<你的子域>.workers.dev
```

#### 后续自动部署（GitHub Actions）

在仓库 Settings → Secrets and variables → Actions 添加两个 Secret：

| Secret | 获取方式 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token → 模板选 **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → Workers & Pages → 右侧 **Account ID** |

配置后，修改 `worker/` 下代码即自动部署（`.github/workflows/deploy-worker.yml`）。
未配置时该工作流会跳过部署并给出提示，不会失败。

#### 技术要点

- 全局单例 Durable Object（`PRESENCE`）作为在线状态唯一权威点
- 使用 `ctx.acceptWebSocket()` 而非 `ws.accept()`，空闲时 DO 可被驱逐，**不收时长费**
- 休眠会清空内存，因此峰值/趋势写入 `storage`，连接身份用 `serializeAttachment` 跟随连接
- 免费版要求使用 SQLite 后端（`new_sqlite_classes`）

#### 本地调试

```bash
cd worker
pnpm dev        # http://localhost:8787
pnpm typecheck
```

### 方式 B：Render（备选，Express 版）

1. 打开 <https://dashboard.render.com/blueprints> → **New Blueprint Instance**
2. 选择仓库 `fmlwlher/orbis-globe`
3. Render 读取根目录 `render.yaml`，自动创建 `orbis-presence-api` 服务

> 免费实例 15 分钟无访问会休眠，首次访问约需 30 秒唤醒。

### 方式 C：Railway / Fly.io / 自建服务器（Docker）

仓库已提供 `backend/Dockerfile`，任何支持容器的平台都可直接用：

```bash
cd backend
docker build -t orbis-api .
docker run -p 3000:3000 -e NODE_ENV=production orbis-api
```

关键环境变量：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 监听端口（平台通常自动注入） | `3000` |
| `NODE_ENV` | 设为 `production` | `development` |
| `CORS_ORIGIN` | 允许的跨域来源，`*` 表示全部 | `*` |
| `LOG_LEVEL` | 日志级别 | `info` |

### 反代注意事项（Nginx / Caddy）

WebSocket 需要透传 `Upgrade` 与 `Connection` 头：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
}
```

---

## 三、把前后端接起来

后端地址有两种接入方式，任选其一。

### 方式 1：GitHub Variable（Pages 构建时注入）

1. 仓库 → Settings → Secrets and variables → Actions → **Variables** → New variable
2. 名称：`VITE_API_BASE_URL`，值：后端地址（**不带结尾斜杠**）

   ```
   https://orbis-presence-api.<你的子域>.workers.dev
   ```

3. 到 Actions 页面重新运行 `Deploy to GitHub Pages`

### 方式 2：本地 `.env`

```bash
cd frontend
cp .env.example .env
# 编辑 .env
VITE_API_BASE_URL=https://orbis-presence-api.onrender.com
```

> 留空则走同源 `/api`，由 Vite dev server 代理到 `localhost:3000`（本地开发用）。

---

## 四、验证

```bash
# 后端健康检查
curl https://<你的后端地址>/api/health

# 在线统计快照
curl https://<你的后端地址>/api/presence
# → {"online":1,"connections":1,"peak":1,...}

# 在线访客明细
curl https://<你的后端地址>/api/presence/visitors
```

浏览器打开页面，顶栏「在线浏览」徽标应显示实时人数，点击展开面板可看到通道状态
（`实时推送` = WebSocket 已连通；`离线演示` = 未接后端）。

---

## 五、接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/presence` | 统计快照（在线/连接/峰值/趋势） |
| `GET` | `/api/presence/visitors` | 在线访客明细（脱敏） |
| `GET` | `/api/presence/stream` | SSE 流（WS 不可用时降级） |
| `POST` | `/api/presence/heartbeat` | 心跳上报（轮询模式） |
| `WS` | `/api/ws/presence` | 实时推送长连接 |
| `GET` | `/api/health` | 健康检查 |

---

## 六、统计口径

- **在线数**：按浏览器 `sessionId` 去重（同一浏览器多标签算 1 人）
- **活跃连接**：含同一访客的多个标签页
- **离线判定**：45 秒无心跳即剔除（覆盖断网、休眠等异常断开）
- **数据存储**：
  - Cloudflare 版：连接状态存于 Durable Object，峰值/趋势写入 DO storage，**重启不丢失**
  - Express 版：纯内存，进程重启后峰值与趋势归零（在线数本身会随连接重建自动恢复）
- **多实例**：Cloudflare 版天然单例（固定 DO 名 `global`）；Express 版多实例需改用 Redis
