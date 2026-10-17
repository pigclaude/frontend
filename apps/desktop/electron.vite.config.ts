// 负责用 electron-vite 分别构建主进程、预加载和渲染进程。
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import type { Connect, Plugin } from "vite"

const stripComments = { legalComments: "none" as const }

/** 开发时让系统浏览器里的授权页通知桌面端。正式环境由权限服务接管。 */
function devAuthorization(): Plugin {
  let approved = false
  const handle: Connect.NextHandleFunction = (req, res, next) => {
    const path = req.url?.split("?")[0]
    if (path === "/authorize/status" && req.method === "GET") {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ approved }))
      return
    }
    if (path === "/authorize/approve" && req.method === "POST") {
      approved = true
      res.end()
      return
    }
    if (path === "/authorize/reset" && req.method === "POST") {
      approved = false
      res.end()
      return
    }
    next()
  }
  return {
    name: "pigclaude-dev-authorization",
    configureServer(server) {
      server.middlewares.use(handle)
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
