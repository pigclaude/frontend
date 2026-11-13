// 负责用 electron-vite 分别构建主进程、预加载和渲染进程。
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import { resolve } from "node:path"
import type { Plugin } from "vite"
import { DevAuthorizationFixture } from "./src/dev/authorization-fixture"
import { createAuthorizationMiddleware } from "./src/dev/authorization-middleware"

const stripComments = { legalComments: "none" as const }

// workspace 源码和安装包不携带的网络依赖必须打进产物，不能留给运行时解析。
const bundledDependencies = [
  "@pigclaude/contracts",
  "@pigclaude/daemon",
  "@pigclaude/local-store",
  "@pigclaude/login-gate",
  "@pigclaude/ui-primitives",
  "@pigclaude/proxy-connection",
  "@pigclaude/session-env",
  "@pigclaude/switcher",
  "undici",
]

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
    build: {
      minify: true,
      sourcemap: false,
      externalizeDeps: { exclude: bundledDependencies },
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/main/index.ts"),
          "xray-watchdog": resolve(import.meta.dirname, "xray-watchdog.cjs"),
        },
      },
    },
  },
  preload: {
    esbuild: stripComments,
    build: {
      minify: true,
      sourcemap: false,
      externalizeDeps: { exclude: bundledDependencies },
    },
  },
  renderer: {
    esbuild: stripComments,
    plugins: [react(), devAuthorization()],
    build: { minify: true, sourcemap: false },
    server: { port: 5173, strictPort: true },
  },
})
