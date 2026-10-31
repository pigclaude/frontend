// 负责用 electron-vite 分别构建主进程、预加载和渲染进程。
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import type { Plugin } from "vite"
import { DevAuthorizationFixture } from "./src/dev/authorization-fixture"
import { createAuthorizationMiddleware } from "./src/dev/authorization-middleware"

const stripComments = { legalComments: "none" as const }

// workspace 包导出 TypeScript 源码，必须打进产物；electron-vite 默认会把 package.json
// 里的依赖全部 external，运行时加载 .ts 会失败。
const bundledWorkspacePackages = [
  "@pigclaude/contracts",
  "@pigclaude/daemon",
  "@pigclaude/local-store",
  "@pigclaude/login-gate",
  "@pigclaude/proxy-connection",
  "@pigclaude/session-env",
  "@pigclaude/switcher",
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
      externalizeDeps: { exclude: bundledWorkspacePackages },
    },
  },
  preload: {
    esbuild: stripComments,
    build: {
      minify: true,
      sourcemap: false,
      externalizeDeps: { exclude: bundledWorkspacePackages },
    },
  },
  renderer: {
    esbuild: stripComments,
    plugins: [react(), devAuthorization()],
    build: { minify: true, sourcemap: false },
    server: { port: 5173, strictPort: true },
  },
})
