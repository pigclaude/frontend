// 负责用 electron-vite 分别构建主进程、预加载和渲染进程。
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import { resolve } from "node:path"
import type { Plugin } from "vite"
import { DevAuthorizationFixture } from "./src/dev/authorization-fixture"
import { createAuthorizationMiddleware } from "./src/dev/authorization-middleware"
import { rendererContentSecurityPolicy } from "./src/main/renderer-csp"

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

/** 构建时把 CSP 写在 head 最前面，早于任何脚本；开发服务器要用内联的热更新脚本，不加。 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "pigclaude-content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: rendererContentSecurityPolicy(),
        },
        injectTo: "head-prepend",
      },
    ],
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
    plugins: [react(), devAuthorization(), contentSecurityPolicy()],
    build: { minify: true, sourcemap: false },
    server: { port: 5173, strictPort: true },
  },
})
