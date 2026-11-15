// 提供能力插件专属协议的固定页面和包内模块，协议不会凭请求访问文件系统或网络。
import supervisor from "./sandbox-supervisor.mjs?raw"
import worker from "./sandbox-worker.mjs?raw"
import { PluginSandboxError, type PluginSandboxSource } from "./plugin-sandbox-contract"

/** 能力插件专用方案，只在它自己的内存分区上注册处理器。 */
export const pluginSandboxScheme = "pigclaude-plugin"

const shellPath = "/runtime/index.html"
const supervisorPath = "/runtime/supervisor.mjs"
const workerPath = "/runtime/worker.mjs"
const html =
  '<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><title>PigClaude</title><script type="module" src="/runtime/supervisor.mjs"></script></html>'
const csp = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ")

/** 一个实例只能看到受信页面、Worker 引导和自己的包内模块。 */
export type PluginSandboxResources = {
  url: string
  entry: string
  permits(url: string): boolean
  handle(request: Request): Response
}

/** 生成不读取本机文件的协议处理器，并为 Worker 单独禁止创建子 Worker。 */
export function createPluginSandboxResources(
  source: PluginSandboxSource,
  host: string,
): PluginSandboxResources {
  const origin = `${pluginSandboxScheme}://${host}`
  const modules = new Map<string, string>()
  for (const [path, body] of Object.entries(source.modules)) {
    if (!validModulePath(path) || typeof body !== "string")
      throw new PluginSandboxError("PLUGIN_BUNDLE_INVALID")
    modules.set(`/modules/${path}`, body)
  }
  const entry = `/modules/${source.entry}`
  if (!modules.has(entry)) throw new PluginSandboxError("PLUGIN_BUNDLE_INVALID")
  function pathOf(value: string): string | null {
    if (!value.startsWith(`${origin}/`)) return null
    const url = URL.parse(value)
    if (
      !url ||
      url.protocol !== `${pluginSandboxScheme}:` ||
      url.host !== host ||
      url.search ||
      url.hash
    )
      return null
    const path = url.pathname
    return path === shellPath || path === supervisorPath || path === workerPath || modules.has(path)
      ? path
      : null
  }
  return {
    url: `${origin}${shellPath}`,
    entry: `${origin}${entry}`,
    permits: (url) => pathOf(url) !== null,
    handle: (request) => {
      const path = pathOf(request.url)
      if (request.method !== "GET" || path === null) return new Response(null, { status: 404 })
      const body =
        path === shellPath
          ? html
          : path === supervisorPath
            ? withoutHeader(supervisor)
            : path === workerPath
              ? withoutHeader(worker)
              : modules.get(path)
      return new Response(body, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type":
            path === shellPath ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": `${csp}; worker-src ${path === shellPath ? "'self'" : "'none'"}`,
        },
      })
    },
  }
}

function validModulePath(path: string): boolean {
  return (
    /\.m?js$/.test(path) &&
    path
      .split("/")
      .every((part) => /^[A-Za-z0-9_.@-]+$/.test(part) && part !== "." && part !== "..")
  )
}

function withoutHeader(text: string): string {
  return text.slice(text.indexOf("\n") + 1)
}
