// 负责配置 pigclaude 管理后台的 Vite 开发服务器、打包插件和本地别名。
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { themeInitializationScript } from "@pigclaude/web-ui/lib/theme-initialization"
import { DEFAULT_RUST_API_TARGET, resolveHomeOrigin } from "./src/lib/runtime-config"

import { adminProxyTarget, createAdminProxyLogger } from "./vite-proxy"

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** 返回管理后台构建配置，并把第一阶段 admin API 代理到 Rust 服务。 */
export default defineConfig({
  customLogger: createAdminProxyLogger(),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "pigclaude-admin-theme",
      transformIndexHtml: () => [
        { tag: "script", children: themeInitializationScript, injectTo: "head-prepend" },
      ],
    },
  ],
  define: {
    "import.meta.env.VITE_HOME_URL": JSON.stringify(
      resolveHomeOrigin(process.env.VITE_HOME_URL ?? process.env.PIGCLAUDE_HOME_URL),
    ),
  },
  esbuild: { legalComments: "none" },
  resolve: { alias: { "@": path.resolve(dirname, "./src") } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/admin/v1": {
        target: adminProxyTarget(process.env.API_PROXY_TARGET ?? DEFAULT_RUST_API_TARGET),
        changeOrigin: false,
      },
    },
  },
})
