// 为当前插件窗口的已许可 HTTPS 请求生成分区响应和该窗口自己的 CORS 头。

import type { PluginSandboxNetwork } from "./plugin-sandbox-contract"

/** 只让持有当次授权的插件源访问响应，预检也先检查目标域。 */
export async function respondToPluginHttps(
  request: Request,
  network: PluginSandboxNetwork,
  signal: AbortSignal,
  origin: string,
): Promise<Response> {
  if (signal.aborted || !network.permits(request.url)) return Response.error()
  // Fetch 把跨源重定向的源标为 null；许可仍由当前分区的调用和域名决定。
  const allowedOrigin = request.headers.get("origin") === "null" ? "null" : origin
  const requestedMethod = request.headers.get("access-control-request-method")
  if (request.method === "OPTIONS" && requestedMethod !== null) {
    const headers = new Headers({
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": requestedMethod,
      "access-control-max-age": "0",
      "cache-control": "no-store",
    })
    const requestedHeaders = request.headers.get("access-control-request-headers")
    if (requestedHeaders !== null) headers.set("access-control-allow-headers", requestedHeaders)
    return new Response(null, { status: 204, headers })
  }
  const response = await network.forward(request, signal)
  if (response.type === "error") return response
  if (signal.aborted) {
    void response.body?.cancel().catch(() => undefined)
    return Response.error()
  }
  const headers = new Headers(response.headers)
  headers.set("cache-control", "no-store")
  headers.set("access-control-allow-origin", allowedOrigin)
  headers.delete("access-control-allow-credentials")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
