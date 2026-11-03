// 负责通过指定的 Xray SOCKS5 入口发送 HTTP 请求，不切换到其他网络路径。

import { Readable } from "node:stream"
import nodeFetch from "node-fetch"
import { XraySocksAgent } from "./xray-socks-agent"

/** OAuth 请求需要的 Xray HTTP 请求参数。 */
export type XrayHttpRequestInit = {
  method: "GET" | "POST"
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
}

/** HTTP 响应提供读取与释放响应体的能力。 */
export type XrayHttpResponse = {
  ok: boolean
  text: () => Promise<string>
  discard: () => Promise<void>
}

/** 固定使用本次 Xray 入口的 HTTP 请求函数。 */
export type XrayHttpRequest = (url: string, input: XrayHttpRequestInit) => Promise<XrayHttpResponse>

/** 创建固定使用本机 Xray SOCKS5 的请求客户端；地址无效时明确失败。 */
export function createXrayHttpClient(bridgeUrl: string): {
  request: XrayHttpRequest
  close: () => void
} {
  const match = /^socks5:\/\/127\.0\.0\.1:(\d{1,5})\/?$/.exec(bridgeUrl)
  const port = Number(match?.[1])
  if (match === null || port < 1 || port > 65535) throw new Error("Xray 入口地址无效")
  const controller = new AbortController()
  const agents = new Set<XraySocksAgent>()
  return {
    request: async (value, input) => {
      const url = new URL(value)
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        throw new Error("Xray 请求地址无效")
      }
      const signal = AbortSignal.any([input.signal, controller.signal])
      signal.throwIfAborted()
      const agent = new XraySocksAgent(port, signal)
      agents.add(agent)
      const release = () => {
        agents.delete(agent)
        agent.destroy()
      }
      try {
        const response = await nodeFetch(url, { ...input, signal, agent, redirect: "manual" })
        return {
          ok: response.ok,
          text: async () => {
            try {
              return await response.text()
            } finally {
              release()
            }
          },
          discard: async () => {
            if (response.body instanceof Readable) response.body.destroy()
            release()
          },
        }
      } catch (error: unknown) {
        release()
        throw error
      }
    },
    close: () => {
      controller.abort()
      for (const agent of agents) agent.destroy()
      agents.clear()
    },
  }
}
