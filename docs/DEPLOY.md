# 部署指南

本项目包含两部分，部署方式不同：

| 部分 | 内容 | 部署位置 | 是否必需 |
| --- | --- | --- | --- |
| 前端 | React + Three.js 三维地球仪 | **GitHub Pages**（静态托管） | 必需 |
| 后端 | 在线用户统计（WebSocket 实时推送） | **Render / Railway** 等 Node 容器平台 | 可选 |

> GitHub Pages 只能托管静态文件，**无法运行 Node 服务**。因此在线人数统计需要单独部署后端；
> 未部署后端时，前端会以「离线演示」模式运行，页面其余功能完全不受影响。

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

### 方式 A：Render 一键部署（推荐，有免费额度）

1. 打开 <https://dashboard.render.com/blueprints> → **New Blueprint Instance**
2. 选择仓库 `fmlwlher/orbis-globe`
3. Render 读取根目录 `render.yaml`，自动创建 `orbis-presence-api` 服务
4. 部署完成后获得地址，形如 `https://orbis-presence-api.onrender.com`

> 免费实例 15 分钟无访问会休眠，首次访问约需 30 秒唤醒；
> 若要保证 WebSocket 实时性，可升级到 Starter 套餐。

### 方式 B：Railway / Fly.io / 自建服务器（Docker）

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
   https://orbis-presence-api.onrender.com
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
- **数据存储**：纯内存，服务重启归零；多实例部署需改用 Redis
