// 负责比较 Xray 的 SOCKS5 本机入口和 daemon 上游代理的出口 IP；不一致或失败时不允许登录。

import { isIP } from "node:net"
import { createProxyAgent } from "@pigclaude/proxy-connection"
import nodeFetch from "node-fetch"
import { ProxyAgent, fetch as undiciFetch } from "undici"
import { XraySocksAgent } from "./xray-socks-agent.ts"

/** 出口核对失败原因。 */
export type EgressFailureReason = "proxy" | "timeout" | "parse" | "mismatch"

/** 出口核对结果。失败文案固定为请勿登录。 */
export type EgressResult =
  { ok: true; ip: string } | { ok: false; reason: EgressFailureReason; message: "请勿登录" }

type FetchLike = typeof undiciFetch
type ProbeResponse = {
  ok: boolean
  status: number
  headers: { get: (name: string) => string | null }
  text: () => Promise<string>
  body: unknown
}

const redirectStatuses = new Set([301, 302, 303, 307, 308])
const maxRedirects = 20

/** 分别经外部代理核心的本机入口和上游代理请求出口检查 URL，要求两次 IP 相同。 */
export async function checkEgress(input: {
  bridgeUrl: string
  upstreamProxyUrl: string
  checkUrl: string
  timeoutMs?: number
  signal?: AbortSignal
  /** 测试注入上游请求；调用时始终提供对应代理 dispatcher。 */
  fetch?: FetchLike
  /** 测试注入本机 SOCKS5 请求；调用时始终提供 Xray agent。 */
  fetchSocks?: typeof nodeFetch
}): Promise<EgressResult> {
  input.signal?.throwIfAborted()
  const checkUrl = httpUrl(input.checkUrl)
  if (checkUrl === null) return { ok: false, reason: "proxy", message: "请勿登录" }
  const timeoutMs = input.timeoutMs ?? 10_000
  const fetchFn = input.fetch ?? undiciFetch
  const fetchSocksFn = input.fetchSocks ?? nodeFetch
  const timeout = AbortSignal.timeout(timeoutMs)
  const bridgeSignal =
    input.signal === undefined ? timeout : AbortSignal.any([timeout, input.signal])
  let bridgeAgent: XraySocksAgent
  try {
    const bridgeUrl = new URL(input.bridgeUrl)
    const port = Number(bridgeUrl.port)
    if (
      bridgeUrl.protocol !== "socks5:" ||
      bridgeUrl.hostname !== "127.0.0.1" ||
      !bridgeUrl.port ||
      port < 1 ||
      port > 65535 ||
      bridgeUrl.username ||
      bridgeUrl.password ||
      (bridgeUrl.pathname !== "" && bridgeUrl.pathname !== "/") ||
      bridgeUrl.search ||
      bridgeUrl.hash
    )
      throw new Error("SOCKS5 地址无效")
    bridgeAgent = new XraySocksAgent(port, bridgeSignal)
  } catch {
    return { ok: false, reason: "proxy", message: "请勿登录" }
  }
  let upstreamAgent: ProxyAgent | null = null
  let upstreamSignal: AbortSignal | undefined
  let destroyUpstream: (() => void) | undefined
  let destroying: Promise<void> | undefined
  try {
    const throughBridge = await readExitIp(checkUrl, (url) =>
      fetchSocksFn(url, { signal: bridgeSignal, redirect: "manual", agent: bridgeAgent }),
    )
    input.signal?.throwIfAborted()
    if (!throughBridge.ok) return throughBridge
    upstreamAgent = createProxyAgent(input.upstreamProxyUrl)
    const dispatcher = upstreamAgent
    const upstreamTimeout = AbortSignal.timeout(timeoutMs)
    const requestSignal =
      input.signal === undefined
        ? upstreamTimeout
        : AbortSignal.any([upstreamTimeout, input.signal])
    upstreamSignal = requestSignal
    destroyUpstream = () => {
      destroying ??= dispatcher.destroy()
      void destroying.catch(() => undefined)
    }
    upstreamSignal.addEventListener("abort", destroyUpstream, { once: true })
    if (upstreamSignal.aborted) destroyUpstream()
    const throughUpstream = await readExitIp(checkUrl, (url) =>
      fetchFn(url, {
        dispatcher,
        signal: requestSignal,
        redirect: "manual",
      }),
    )
    input.signal?.throwIfAborted()
    if (upstreamTimeout.aborted) return { ok: false, reason: "timeout", message: "请勿登录" }
    if (!throughUpstream.ok) return throughUpstream
    if (throughBridge.ip !== throughUpstream.ip) {
      return { ok: false, reason: "mismatch", message: "请勿登录" }
    }
    return { ok: true, ip: throughBridge.ip }
  } finally {
    bridgeAgent.destroy()
    try {
      if (upstreamAgent !== null) {
        if (upstreamSignal?.aborted) destroyUpstream?.()
        if (destroying !== undefined) await destroying
        else await upstreamAgent.close()
      }
    } finally {
      if (destroyUpstream !== undefined)
        upstreamSignal?.removeEventListener("abort", destroyUpstream)
    }
  }
}

/** 解析出口检查响应。支持 ip= 文本行和 { "ip": "..." } JSON；解析不出合法 IP 时返回 null。 */
export function parseExitIp(body: string): string | null {
  const trimmed = body.trim()
  if (trimmed === "") return null
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isRecord(parsed) && typeof parsed.ip === "string") return normalizeIp(parsed.ip)
    } catch {
      return null
    }
    return null
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const match = /^ip=(.+)$/.exec(line.trim())
    if (match?.[1] !== undefined) return normalizeIp(match[1])
  }
  return normalizeIp(trimmed)
}

async function readExitIp(
  initialUrl: string,
  request: (url: string) => Promise<ProbeResponse>,
): Promise<EgressResult> {
  let url = initialUrl
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let response: ProbeResponse
    try {
      response = await request(url)
    } catch (error: unknown) {
      return { ok: false, reason: isTimeout(error) ? "timeout" : "proxy", message: "请勿登录" }
    }
    const location = redirectStatuses.has(response.status) ? response.headers.get("location") : null
    if (location !== null) {
      await discard(response.body)
      const next = httpUrl(location, url)
      if (next === null || redirects === maxRedirects) {
        return { ok: false, reason: "proxy", message: "请勿登录" }
      }
      url = next
      continue
    }
    if (!response.ok) {
      await discard(response.body)
      return { ok: false, reason: "proxy", message: "请勿登录" }
    }
    let text: string
    try {
      text = await response.text()
    } catch {
      return { ok: false, reason: "proxy", message: "请勿登录" }
    }
    const ip = parseExitIp(text)
    if (ip === null) return { ok: false, reason: "parse", message: "请勿登录" }
    return { ok: true, ip }
  }
  return { ok: false, reason: "proxy", message: "请勿登录" }
}

function httpUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

async function discard(body: unknown): Promise<void> {
  if (hasCancel(body)) await body.cancel().catch(() => undefined)
  else if (hasDestroy(body)) body.destroy()
}

function normalizeIp(value: string): string | null {
  const trimmed = value.trim()
  return isIP(trimmed) === 0 ? null : trimmed
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasCancel(value: unknown): value is { cancel: () => Promise<unknown> } {
  return isRecord(value) && typeof value.cancel === "function"
}

function hasDestroy(value: unknown): value is { destroy: () => unknown } {
  return isRecord(value) && typeof value.destroy === "function"
}
