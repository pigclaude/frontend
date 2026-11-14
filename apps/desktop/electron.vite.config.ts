// 负责用 electron-vite 分别构建主进程、预加载和渲染进程。
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Plugin } from "vite"
import { DevAuthorizationFixture } from "./src/dev/authorization-fixture"
import { createAuthorizationMiddleware } from "./src/dev/authorization-middleware"
import { mainBundledDependencies } from "./src/main/main-bundled-dependencies"
import { rendererContentSecurityPolicy } from "./src/main/renderer-csp"

const stripComments = { legalComments: "none" as const }

const bundledDependencies = mainBundledDependencies(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")),
  JSON.parse(readFileSync(resolve(import.meta.dirname, "electron-builder.json"), "utf8")),
)

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
