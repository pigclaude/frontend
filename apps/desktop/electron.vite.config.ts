// 负责用 electron-vite 分别构建主进程、预加载和渲染进程。
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import type { Plugin } from "vite"
import { DevAuthorizationFixture } from "./src/dev/authorization-fixture"
import { createAuthorizationMiddleware } from "./src/dev/authorization-middleware"

const stripComments = { legalComments: "none" as const }

/** 开发时让系统浏览器里的授权页通知桌面端。正式环境由权限服务接管。 */
function devAuthorization(): Plugin {
  const fixture = new DevAuthorizationFixture()
  return {
    name: "pigclaude-dev-authorization",
    configureServer(server) {
      server.middlewares.use(createAuthorizationMiddleware(fixture))
    },
  }
}

export default defineConfig({
  main: {
    esbuild: stripComments,
    build: { minify: true, sourcemap: false },
  },
  preload: {
    esbuild: stripComments,
    build: { minify: true, sourcemap: false },
  },
  renderer: {
    esbuild: stripComments,
    plugins: [react(), devAuthorization()],
    build: { minify: true, sourcemap: false },
    server: { port: 5173, strictPort: true },
  },
})
