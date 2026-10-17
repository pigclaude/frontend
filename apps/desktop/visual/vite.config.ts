// 负责视觉回归用的纯渲染进程开发服务器配置，不启动 Electron，端口避开本机常见的 5173。
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: fileURLToPath(new URL("../src/renderer", import.meta.url)),
  plugins: [react()],
  server: { port: 5273, strictPort: true },
})
