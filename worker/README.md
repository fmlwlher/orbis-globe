# ORBIS Presence API · Cloudflare Workers

在线用户统计服务，接口与 `backend/`（Express 版）完全一致。

```bash
pnpm install
pnpm dev        # 本地 http://localhost:8787
pnpm typecheck
pnpm deploy     # 部署到 Cloudflare
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/presence` | 统计快照 |
| GET | `/api/presence/visitors` | 在线访客明细 |
| GET | `/api/presence/stream` | SSE 流 |
| POST | `/api/presence/heartbeat` | 轮询上报 |
| WS | `/api/ws/presence` | 实时推送 |
| GET | `/api/health` | 健康检查 |

详细部署说明见 [`docs/DEPLOY.md`](../docs/DEPLOY.md)。
