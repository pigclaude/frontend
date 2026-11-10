// 固定 daemon 上游边界；仅可信构造依赖可使用 HTTPS 诊断目标或本机 HTTP 假端点。

/** 创建不可被调用方后续修改的 origin；默认始终为官方 API。 */
export function daemonOrigin(diagnostic?: URL): URL {
  const origin = new URL(diagnostic?.href ?? "https://api.anthropic.com")
  const localHttp = origin.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(origin.hostname)
  if (
    (origin.protocol !== "https:" && !localHttp) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("invalid trusted daemon origin")
  return origin
}

/** 只采用请求的 path/query，最终目标必须留在该实例创建时固定的 origin。 */
export function daemonUpstreamUrl(requestUrl: string | undefined, origin: URL): URL | null {
  let incoming: URL
  try {
    incoming = new URL(requestUrl ?? "/", "http://127.0.0.1")
  } catch {
    return null
  }
  if (!incoming.pathname.startsWith("/") || incoming.pathname.startsWith("//")) return null
  const upstream = new URL(incoming.pathname + incoming.search, origin)
  return upstream.origin === origin.origin ? upstream : null
}
