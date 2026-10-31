// 负责比较代理桥和 daemon 同款 ProxyAgent 的出口 IP；不一致或失败时不允许登录。

import { isIP } from "node:net"
import { createProxyAgent } from "@pigclaude/proxy-connection"
import { ProxyAgent, fetch as undiciFetch } from "undici"

/** 出口核对失败原因。 */
export type EgressFailureReason = "proxy" | "timeout" | "parse" | "mismatch"

/** 出口核对结果。失败文案固定为请勿登录。 */
export type EgressResult =
  { ok: true; ip: string } | { ok: false; reason: EgressFailureReason; message: "请勿登录" }

type FetchLike = typeof undiciFetch

/** 分别经代理桥和上游代理请求出口检查 URL，要求两次 IP 相同。 */
export async function checkEgress(input: {
  bridgeUrl: string
  upstreamProxyUrl: string
  checkUrl: string
  timeoutMs?: number
  fetch?: FetchLike
}): Promise<EgressResult> {
  const timeoutMs = input.timeoutMs ?? 10_000
  const fetchFn = input.fetch ?? undiciFetch
  const bridgeAgent = new ProxyAgent(input.bridgeUrl)
  let directAgent: ProxyAgent | null = null
  try {
    const throughBridge = await readExitIp(fetchFn, input.checkUrl, bridgeAgent, timeoutMs)
    if (!throughBridge.ok) return throughBridge
    directAgent = createProxyAgent(input.upstreamProxyUrl)
    const throughUpstream = await readExitIp(fetchFn, input.checkUrl, directAgent, timeoutMs)
    if (!throughUpstream.ok) return throughUpstream
    if (throughBridge.ip !== throughUpstream.ip) {
      return { ok: false, reason: "mismatch", message: "请勿登录" }
    }
    return { ok: true, ip: throughBridge.ip }
  } finally {
    await bridgeAgent.close().catch(() => undefined)
    if (directAgent !== null) await directAgent.close().catch(() => undefined)
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
  fetchFn: FetchLike,
  url: string,
  dispatcher: ProxyAgent,
  timeoutMs: number,
): Promise<EgressResult> {
  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await fetchFn(url, {
      dispatcher,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    })
  } catch (error: unknown) {
    return {
      ok: false,
      reason: isTimeout(error) ? "timeout" : "proxy",
      message: "请勿登录",
    }
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
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
