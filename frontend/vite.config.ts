import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react-swc"
import {defineConfig} from "vite"
import process from "process"

/**
 * 部署基路径：
 * - GitHub Actions 构建时注入 GITHUB_REPOSITORY（形如 owner/repo），自动取 `/<repo>/`
 * - 也可用 VITE_BASE_PATH 手动覆盖（如自定义域名设为 "/"）
 * - 本地开发回退为 "/"
 */
function resolveBase(): string {
  if (process.env.VITE_BASE_PATH) return process.env.VITE_BASE_PATH

  const repo = process.env.GITHUB_REPOSITORY
  if (repo && repo.includes("/")) {
    const name = repo.split("/")[1]
    // 用户主页仓库（owner/owner.github.io）需挂在根路径
    if (name.endsWith(".github.io")) return "/"
    return `/${name}/`
  }
  return "/"
}

// https://vite.dev/config/
export default defineConfig({
  base: resolveBase(),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    // 贴图较大（约 4MB），放宽告警阈值避免噪声
    chunkSizeWarningLimit: 1200,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: '::',
    port: 5173,
    allowedHosts: true,
    cors: true,
    hmr: {
        protocol: 'wss',
        host: `5173-${process.env.X_IDE_SPACE_KEY}.e2b.${process.env.X_IDE_SPACE_REGION}.${process.env.X_IDE_SPACE_HOST}`
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        ws: true
      },
    },
  },
})
