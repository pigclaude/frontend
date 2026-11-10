// 负责代理的新增、修改、删除、测试和出口核对；视图不包含代理密码。

import { randomUUID } from "node:crypto"
import type { EgressView, ProxyView } from "@pigclaude/contracts/claude-account"
import type { IpProxy, LocalStore } from "@pigclaude/local-store"
import { checkEgress, parseExitIp } from "@pigclaude/login-gate/egress-check"
import type { StartProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import { createProxyAgent } from "@pigclaude/proxy-connection"
import { fetch as undiciFetch, type ProxyAgent } from "undici"
import { ClaudeAccountError } from "./errors"
import { isValidBridgeUrl } from "./launch-argument-guard"

import { defaultEnvironmentExitUrl } from "./environment-targets"
const defaultCheckUrl = defaultEnvironmentExitUrl

/** 代理服务依赖。保证渲染进程只拿到脱敏 URL。 */
export type ProxyServiceDeps = {
  store: LocalStore
  checkUrl?: string
  now?: () => number
  /** 外部代理核心未接入时，出口一致性核对明确拒绝执行。 */
  startProxyRuntime?: StartProxyRuntime
}

/** 本机代理服务。保证测试失败时返回失败结果而不是改走直连。 */
export class ProxyService {
  readonly #store: LocalStore
  readonly #checkUrl: string
  readonly #now: () => number
  readonly #startProxyRuntime: StartProxyRuntime | undefined

  /** 创建绑定到本机代理文件的代理服务。 */
  constructor(deps: ProxyServiceDeps) {
    this.#store = deps.store
    this.#checkUrl = deps.checkUrl ?? defaultCheckUrl
    this.#now = deps.now ?? Date.now
    this.#startProxyRuntime = deps.startProxyRuntime
  }

  /** 返回脱敏代理列表。 */
  async list(): Promise<ProxyView[]> {
    const proxies = await this.#store.listProxies()
    return proxies.map(toView)
  }

  /** 新增或修改代理。保证 URL 是 HTTP/HTTPS 且不以明文密码进入视图。 */
  async save(input: { id?: string; name: string; url: string }): Promise<ProxyView> {
    const name = input.name.trim()
    if (name === "") throw new ClaudeAccountError("INVALID_INPUT", "代理名称不能为空")
    assertProxyUrl(input.url)
    const existing = input.id === undefined ? null : await this.#store.getProxy(input.id)
    const proxy: IpProxy = {
      schemaVersion: 1,
      id: input.id ?? randomUUID(),
      name,
      url: input.url,
      lastTest: existing?.url === input.url ? existing.lastTest : null,
    }
    await this.#store.saveProxy(proxy)
    return toView(proxy)
  }

  /** 使用 Xray 核对新代理出口，只有验证成功后才持久化。 */
  async saveVerified(input: { name: string; url: string }): Promise<ProxyView> {
    const name = input.name.trim()
    if (name === "") throw new ClaudeAccountError("INVALID_INPUT", "代理名称不能为空")
    assertProxyUrl(input.url)
    const startedAt = Date.now()
    let result: EgressView
    try {
      result = await this.checkProxyEgress(input.url)
    } catch {
      throw new ClaudeAccountError("PROXY_UNAVAILABLE", "代理验证失败，请检查代理和 Xray")
    }
    if (!result.ok) {
      throw new ClaudeAccountError("PROXY_UNAVAILABLE", "代理验证失败，请检查代理和 Xray")
    }
    const proxy: IpProxy = {
      schemaVersion: 1,
      id: randomUUID(),
      name,
      url: input.url,
      lastTest: {
        ok: true,
        ip: result.ip,
        latencyMs: Date.now() - startedAt,
        testedAt: new Date(this.#now()).toISOString(),
      },
    }
    await this.#store.saveProxy(proxy)
    return toView(proxy)
  }

  /** 删除代理。保证不删除账号记录。 */
  async remove(id: string): Promise<void> {
    await this.#store.removeProxy(id)
  }

  /** 测试代理出口。保证失败时记录失败结果，不改走直连。 */
  async test(id: string): Promise<ProxyView> {
    const proxy = await this.#store.getProxy(id)
    if (proxy === null) throw new ClaudeAccountError("PROXY_INVALID", "代理不存在")
    const startedAt = Date.now()
    let ip: string | null = null
    let ok = false
    let dispatcher: ProxyAgent | null = null
    try {
      dispatcher = createProxyAgent(proxy.url)
      const response = await undiciFetch(this.#checkUrl, {
        dispatcher,
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      })
      if (response.ok) {
        const body = await response.text()
        ip = parseExitIp(body)
        ok = ip !== null
      } else {
        await response.body?.cancel().catch(() => undefined)
      }
    } catch {
      ok = false
    } finally {
      await dispatcher?.close().catch(() => undefined)
    }
    const updated: IpProxy = {
      ...proxy,
      lastTest: {
        ok,
        ip,
        latencyMs: Date.now() - startedAt,
        testedAt: new Date(this.#now()).toISOString(),
      },
    }
    await this.#store.saveProxy(updated)
    return toView(updated)
  }

  /** 经外部代理核心的本机入口和上游代理各查一次出口，要求一致。 */
  async checkEgress(id: string): Promise<EgressView> {
    const proxy = await this.#store.getProxy(id)
    if (proxy === null) throw new ClaudeAccountError("PROXY_INVALID", "代理不存在")
    return this.checkProxyEgress(proxy.url)
  }

  private async checkProxyEgress(upstreamProxyUrl: string): Promise<EgressView> {
    if (this.#startProxyRuntime === undefined) {
      throw new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 代理尚未接入，无法核对浏览器出口")
    }
    const runtime = await this.#startProxyRuntime({ upstreamProxyUrl })
    try {
      const bridgeUrl = runtime?.url
      if (!isValidBridgeUrl(bridgeUrl)) {
        throw new ClaudeAccountError("PROXY_UNAVAILABLE", "本机代理入口不可用，无法核对浏览器出口")
      }
      const result = await checkEgress({
        bridgeUrl,
        upstreamProxyUrl,
        checkUrl: this.#checkUrl,
      })
      runtime.assertRunning?.()
      return result
    } finally {
      await runtime?.close()
    }
  }
}

/** 把代理 URL 的密码替换为 ***。解析失败时返回空字符串，避免把原文带到 renderer。 */
export function redactProxyUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.username === "" && url.password === "") return url.toString()
    const auth = url.password === "" ? url.username : `${url.username}:***`
    return `${url.protocol}//${auth}@${url.host}${url.pathname}${url.search}`
  } catch {
    return ""
  }
}

function assertProxyUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ClaudeAccountError("PROXY_INVALID", "代理地址无效")
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.host === "") {
    throw new ClaudeAccountError("PROXY_INVALID", "代理只支持 HTTP/HTTPS")
  }
}

function toView(proxy: IpProxy): ProxyView {
  return {
    id: proxy.id,
    name: proxy.name,
    url: redactProxyUrl(proxy.url),
    lastTest: proxy.lastTest,
  }
}
