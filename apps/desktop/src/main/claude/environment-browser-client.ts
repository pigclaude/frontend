// 通过本次浏览器的专用管道读取配置和 native 网络证据，并回收本轮拥有的诊断页面。

import type { BrowserControlPipe } from "./browser-control-pipe"
import type { NativeEnvironmentResponse } from "./environment-check-model"

/** 本轮拥有的目标与扁平化控制会话。 */
export type EnvironmentPage = { targetId: string; sessionId: string }

/** 只为固定自检操作封装 CDP；所有等待有界，关闭失败不会继续处置仍被引用的上下文。 */
export class EnvironmentBrowserClient {
  readonly #pipe: BrowserControlPipe
  readonly #signal: AbortSignal

  /** 绑定实际浏览器控制管道及本次授权取消信号。 */
  constructor(pipe: BrowserControlPipe, signal: AbortSignal) {
    this.#pipe = pipe
    this.#signal = signal
  }

  /** 发送有界命令；浏览器退出或授权取消同样终止等待。 */
  async command(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.wait(this.#pipe.request(method, params, sessionId), 12_000)
    } catch (cause: unknown) {
      throw new Error(`自检协议命令 ${method} 失败`, { cause })
    }
  }

  /** 有界等待本轮操作，不把超时或取消当成采样成功。 */
  async wait<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // 调用方已创建的命令即使遇到提前取消，也必须观察其拒绝，避免清理阶段遗留异常。
      if (this.#signal.aborted) void operation.catch(() => undefined)
      this.#signal.throwIfAborted()
      return await this.#pipe.race(
        Promise.race([
          operation,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("自检操作超时")), timeoutMs)
          }),
        ]),
      )
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** 在受控页面读取纯值；页面异常信息不回显到产品。 */
  async evaluate(page: EnvironmentPage, expression: string): Promise<unknown> {
    const value = await this.command(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      page.sessionId,
    )
    if (value.exceptionDetails !== undefined || !record(value.result))
      throw new Error("无法读取自检观测")
    return value.result.value
  }

  /** 在本轮空白报告页面展示可信 HTML，保持授权参数不进入地址栏。 */
  async render(page: EnvironmentPage, html: string): Promise<void> {
    const tree = await this.command("Page.getFrameTree", {}, page.sessionId)
    if (!record(tree.frameTree) || !record(tree.frameTree.frame)) throw new Error("自检页面不可用")
    const frameId = text(tree.frameTree.frame, "id")
    await this.command("Page.setDocumentContent", { frameId, html }, page.sessionId)
  }

  /** 读取当前顶层文档的 native 身份，用于在 DOM 观测前后核对同一导航。 */
  async documentIdentity(
    page: EnvironmentPage,
  ): Promise<{ frameId: string; loaderId: string; url: string }> {
    const tree = await this.command("Page.getFrameTree", {}, page.sessionId)
    if (!record(tree.frameTree) || !record(tree.frameTree.frame))
      throw new Error("顶层文档证据缺失")
    const frame = tree.frameTree.frame
    return {
      frameId: text(frame, "id"),
      loaderId: text(frame, "loaderId"),
      url: text(frame, "url"),
    }
  }

  /** 创建普通后台页面；isolated 时不携带账号 Cookie，proxy 仅用于失效演练。 */
  async withPage<T>(
    isolated: boolean,
    proxy: string | undefined,
    operation: (page: EnvironmentPage) => Promise<T>,
  ): Promise<T> {
    let contextId: string | undefined
    let targetId: string | undefined
    try {
      if (isolated) {
        const context = await this.command("Target.createBrowserContext", {
          disposeOnDetach: true,
          ...(proxy ? { proxyServer: proxy, proxyBypassList: "<-loopback>" } : {}),
        })
        contextId = text(context, "browserContextId")
      }
      const target = await this.command("Target.createTarget", {
        url: "about:blank",
        background: true,
        ...(isolated ? { newWindow: true } : {}),
        ...(contextId ? { browserContextId: contextId } : {}),
      })
      targetId = text(target, "targetId")
      const attached = await this.command("Target.attachToTarget", { targetId, flatten: true })
      const page = { targetId, sessionId: text(attached, "sessionId") }
      await this.command("Runtime.enable", {}, page.sessionId)
      await this.command("Network.enable", {}, page.sessionId)
      await this.command("Network.setCacheDisabled", { cacheDisabled: true }, page.sessionId)
      await this.command("Network.setBypassServiceWorker", { bypass: true }, page.sessionId)
      return await operation(page)
    } finally {
      // Chrome 156 要求先确认页面关闭，才能安全销毁其上下文。
      if (targetId) {
        const closed = await this.command("Target.closeTarget", { targetId })
        if (closed.success !== true) throw new Error("无法确认自检页面已关闭")
      }
      if (contextId)
        await this.command("Target.disposeBrowserContext", { browserContextId: contextId })
    }
  }

  /** 等待目标文档稳定，不用固定延时猜测页面是否已加载。 */
  async waitForDocument(page: EnvironmentPage, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const state = await this.evaluate(page, "({ready:document.readyState,url:location.href})")
        if (record(state) && state.ready === "complete" && state.url !== "about:blank") return
      } catch {
        this.#signal.throwIfAborted()
      }
      await this.wait(new Promise<void>((resolve) => setTimeout(resolve, 25)), 100)
    }
    throw new Error("自检文档尚未就绪")
  }

  /** 采集 native 响应与文档身份；IP 读取有上限的正文，控件导航可只读元数据。 */
  async network(
    page: EnvironmentPage,
    url: string,
    options: {
      navigation?: boolean
      timeoutMs?: number
      readBody?: boolean
      headers?: Record<string, string>
    } = {},
  ): Promise<NativeEnvironmentResponse> {
    const navigation = options.navigation ?? false
    const timeoutMs = options.timeoutMs ?? 10_000
    const observation: NativeEnvironmentResponse = {
      url,
      frameId: null,
      loaderId: null,
      status: 0,
      body: "",
      peerAddress: null,
      peerPort: null,
      error: null,
      fromCache: false,
      fromServiceWorker: false,
      secure: false,
      headers: {},
    }
    let requestId: string | undefined
    let navigationFrame: unknown
    let navigationLoader: unknown
    let finish: () => void = () => undefined
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })
    const subscription = this.#pipe.watch((message) => {
      if (message.sessionId !== page.sessionId || !record(message.params)) return false
      const params = message.params
      if (
        message.method === "Network.requestWillBeSent" &&
        record(params.request) &&
        params.request.url === url &&
        typeof params.requestId === "string" &&
        (!navigation || params.type === "Document")
      ) {
        requestId = params.requestId
        observation.frameId = typeof params.frameId === "string" ? params.frameId : null
        observation.loaderId = typeof params.loaderId === "string" ? params.loaderId : null
      }
      if (params.requestId !== requestId || requestId === undefined) return false
      if (message.method === "Network.responseReceived" && record(params.response)) {
        const response = params.response
        if (typeof params.frameId === "string") observation.frameId = params.frameId
        if (typeof params.loaderId === "string") observation.loaderId = params.loaderId
        observation.url = typeof response.url === "string" ? response.url : url
        observation.status = typeof response.status === "number" ? response.status : 0
        observation.peerAddress =
          typeof response.remoteIPAddress === "string" ? response.remoteIPAddress : null
        observation.peerPort = typeof response.remotePort === "number" ? response.remotePort : null
        observation.fromCache ||=
          response.fromDiskCache === true || response.fromPrefetchCache === true
        observation.fromServiceWorker = response.fromServiceWorker === true
        observation.secure = response.securityState === "secure"
        if (record(response.headers))
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === "string") observation.headers[name.toLowerCase()] = value
          }
      }
      if (message.method === "Network.requestServedFromCache") observation.fromCache = true
      if (message.method === "Network.loadingFinished") finish()
      if (message.method === "Network.loadingFailed") {
        observation.error =
          typeof params.errorText === "string" && /^(net::)?ERR_[\w.]+$/.test(params.errorText)
            ? params.errorText
            : "network_failure"
        finish()
      }
      return false
    })
    try {
      if (navigation) {
        const result = await this.command("Page.navigate", { url }, page.sessionId)
        navigationFrame = result.frameId
        navigationLoader = result.loaderId
        if (typeof result.errorText === "string") {
          observation.error = "navigation_failed"
          finish()
        }
      } else {
        await this.wait(
          this.evaluate(
            page,
            `fetch(${JSON.stringify(url)}, {headers:${JSON.stringify(options.headers ?? {})},credentials:"omit",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(${Math.max(500, timeoutMs - 500)})}).then(async response=>{await response.arrayBuffer();return true}).catch(()=>false)`,
          ),
          timeoutMs,
        )
      }
      await this.wait(completed, timeoutMs)
      if (
        navigation &&
        observation.status > 0 &&
        observation.error === null &&
        (observation.frameId !== navigationFrame || observation.loaderId !== navigationLoader)
      )
        observation.error = "document_mismatch"
      if (
        options.readBody !== false &&
        requestId &&
        observation.status > 0 &&
        observation.error === null
      ) {
        const result = await this.command("Network.getResponseBody", { requestId }, page.sessionId)
        if (typeof result.body === "string" && result.body.length <= 65_536) {
          observation.body =
            result.base64Encoded === true
              ? Buffer.from(result.body, "base64").toString("utf8")
              : result.body
        } else observation.error = "response_too_large"
      }
    } catch {
      this.#signal.throwIfAborted()
      observation.error ??= "probe_unavailable"
    } finally {
      subscription.cancel()
    }
    return observation
  }
}

/** 检查协议数据是否为普通对象，避免信任不完整的浏览器响应。 */
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value: Record<string, unknown>, key: string): string {
  const result = value[key]
  if (typeof result !== "string" || result === "") throw new Error("自检控制响应不完整")
  return result
}
