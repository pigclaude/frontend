// 负责配置 pigclaude 管理后台的 Vite 开发服务器、打包插件和本地别名。
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** 返回管理后台构建配置，并把第一阶段 admin API 代理到 Rust 服务。 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(dirname, "./src") } },
  server: {
    port: 5173,
    proxy: {
      "/admin/v1": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8081",
        changeOrigin: true,
      },
    },
  },
})
