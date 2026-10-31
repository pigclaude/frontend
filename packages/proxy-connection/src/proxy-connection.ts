// 负责创建直接连接上游代理的 dispatcher，并统一 Basic 账号密码的编码语义。

import { ProxyAgent } from "undici"

/** 创建上游代理连接；任一凭据非空时发送 Basic，且代理 URI 不包含凭据。 */
export function createProxyAgent(proxyUrl: string): ProxyAgent {
  const endpoint = new URL(proxyUrl)
  const username = decodeURIComponent(endpoint.username)
  const password = decodeURIComponent(endpoint.password)
  endpoint.username = ""
  endpoint.password = ""
  if (username === "" && password === "") return new ProxyAgent(endpoint.href)
  const token = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
  return new ProxyAgent({ uri: endpoint.href, token })
}
