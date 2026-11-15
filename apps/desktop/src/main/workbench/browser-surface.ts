// 内置浏览器使用独立沙箱和 WebContentsView，页面没有桌面 preload 或 Node 能力。
import { WebContentsView, shell, type BrowserWindow } from "electron"
import type { BrowserNavigationTarget } from "../../browser-permission-contract"
import type {
  WorkbenchBrowserAction,
  WorkbenchBrowserActivity,
  WorkbenchBrowserBounds,
  WorkbenchBrowserPage,
  WorkbenchEvent,
} from "../../workbench-contract"
import {
  installAgentBrowserNetwork,
  isAgentBrowserAddress,
  type AgentBrowserNetwork,
} from "./agent-browser-network"
import {
  assertBrowserActionActive,
  awaitBrowserAction,
  clickBrowserPoint,
  navigateBrowserHistory,
  planBrowserNavigation,
  preparedBrowserAction,
} from "./browser-action-execution"
import { BrowserActionError, type PreparedBrowserAction } from "./browser-action-request"
import {
  agentSession,
  allowsWorkbenchBrowserAddress,
  browserSession,
  configureContents,
  workbenchAgentBrowserUrl,
  workbenchBrowserUrl,
} from "./browser-context"
import { pickWorkbenchBrowserElement } from "./browser-element-picker"
import { WorkbenchBrowserPreviews } from "./browser-preview-windows"
import {
  BrowserReferences,
  StaleBrowserReference,
  type AgentBrowserElement,
} from "./browser-references"
import {
  BrowserScreenshotError,
  browserViewPixelSize,
  captureBrowserView,
  prepareBrowserScreenshot,
  releaseBrowserCaptureView,
  type PreparedBrowserScreenshot,
} from "./browser-screenshot"

export { workbenchAgentBrowserUrl, workbenchBrowserUrl } from "./browser-context"

const maxBrowsers = 12
type Surface = {
  window: BrowserWindow
  view: WebContentsView
  error?: WorkbenchBrowserPage["error"]
  crashed?: WorkbenchBrowserPage["crashed"]
  activity?: WorkbenchBrowserActivity
  pickVersion: number
  agent: AgentBrowserNetwork | null
  references: BrowserReferences | null
  attached: boolean
  scale: number
}
type AgentSurface = Surface & { agent: AgentBrowserNetwork; references: BrowserReferences }

function isAgentSurface(entry: Surface): entry is AgentSurface {
  return entry.agent !== null && entry.references !== null
}

function resetBrowserNavigation(entry: Surface): void {
  entry.error = undefined
  entry.crashed = undefined
  entry.pickVersion += 1
  entry.references?.invalidate()
}

/** 管理浏览器标签和本机预览窗口；内容尺寸由受信主窗口报告。 */
export class WorkbenchBrowsers {
  readonly #surfaces = new Map<string, Surface>()
  readonly #previews = new WorkbenchBrowserPreviews()

  /** 打开指定标签的地址，保留该标签的导航历史。 */
  async navigate(window: BrowserWindow, id: string, input: unknown): Promise<void> {
    const url = workbenchBrowserUrl(input)
    const entry = this.#entry(window, id)
    if (entry.agent && !isAgentBrowserAddress(url.href)) throw new Error("PREVIEW_URL_NOT_ALLOWED")
    await entry.agent?.ready
    resetBrowserNavigation(entry)
    try {
      await entry.view.webContents.loadURL(url.href)
    } catch (error: unknown) {
      if (this.#surfaces.get(id) !== entry || entry.view.webContents.isDestroyed()) return
      if (error instanceof Error && error.message.includes("ERR_ABORTED")) return
      entry.error ??= { code: -2, description: "ERR_FAILED", url: url.href }
      this.#publish(id, entry)
    }
  }

  /** 在会话自己的浏览器中打开本机开发页，或读取当前页的可见快照。 */
  async agentPage(window: BrowserWindow, id: string, input?: string): Promise<string> {
    if (input !== undefined) {
      const url = workbenchAgentBrowserUrl(input)
      const entry = this.#entry(window, id, true)
      await this.navigate(window, id, url.href)
      if (this.#surfaces.get(id) !== entry || entry.error)
        throw new Error("WORKBENCH_PREVIEW_FAILED")
      this.#send(window, { type: "browser-open", id, url: url.href })
    }
    const entry = this.#surfaces.get(id)
    if (entry?.window !== window || !entry.agent || !entry.references || entry.error)
      throw new Error("WORKBENCH_PREVIEW_FAILED")
    const contents = entry.view.webContents
    const current = workbenchBrowserUrl(contents.getURL())
    if (!isAgentBrowserAddress(current.href)) throw new Error("PREVIEW_URL_NOT_ALLOWED")
    const snapshot =
      input === undefined
        ? await entry.references.snapshot()
        : {
            text: (await contents.executeJavaScriptInIsolatedWorld(1001, [
              { code: "(document.body?.innerText ?? '').trim().slice(0, 6000)" },
            ])) as unknown,
          }
    return JSON.stringify({
      url: current.href,
      title: contents.getTitle(),
      ...snapshot,
      text: typeof snapshot.text === "string" ? snapshot.text : "",
      blockedRequests: entry.agent.blockedRequests,
    })
  }

  /** 用当前 Agent 标签的引用表读取元素；页面已导航或引用无效时提示重新快照。 */
  async agentElement(
    window: BrowserWindow,
    id: string,
    ref: string,
  ): Promise<AgentBrowserElement & { url: string }> {
    const entry = this.#surfaces.get(id)
    if (entry?.window !== window || !entry.references || entry.error)
      throw new StaleBrowserReference()
    const url = entry.view.webContents.getURL()
    if (!isAgentBrowserAddress(url)) throw new StaleBrowserReference()
    const element = await entry.references.resolve(ref)
    if (this.#surfaces.get(id) !== entry) throw new StaleBrowserReference()
    return { ...element, url }
  }

  /** 读取导航的实际目标，批准后才创建或移动会话浏览器。 */
  async prepareAgentNavigation(
    window: BrowserWindow,
    id: string,
    target: BrowserNavigationTarget,
  ): Promise<PreparedBrowserAction> {
    const original = this.#agentSurface(window, id)
    const verifyDocument = original?.references.documentGuard()
    const { context, index } = planBrowserNavigation(original?.view.webContents, target)
    const intent = context.action === "url" ? { url: context.url } : { action: context.action }
    return preparedBrowserAction(context, async (signal) => {
      if (signal) assertBrowserActionActive(signal)
      if (this.#agentSurface(window, id) !== original) throw new StaleBrowserReference()
      verifyDocument?.()
      if (!original && this.#surfaces.size >= maxBrowsers)
        throw new BrowserActionError("Close another browser tab before opening an Agent page.")
      const entry = original ?? this.#entry(window, id, true)
      if (!isAgentSurface(entry)) throw new StaleBrowserReference()
      return this.#runAgentAction(id, entry, context, 20_000, signal, async (control) => {
        await awaitBrowserAction(entry.agent.ready, control)
        assertBrowserActionActive(control)
        if (this.#agentSurface(window, id) !== entry) throw new StaleBrowserReference()
        verifyDocument?.()
        const contents = entry.view.webContents
        const current = planBrowserNavigation(contents, intent)
        if (current.context.url !== context.url || current.index !== index)
          throw new StaleBrowserReference()
        resetBrowserNavigation(entry)
        this.#send(window, { type: "browser-open", id, url: context.url })
        if (context.action === "url") await contents.loadURL(context.url)
        else await navigateBrowserHistory(contents, index, control)
      })
    })
  }

  /** 读取当前引用的角色和名称，批准后才滚动、命中和点击。 */
  async prepareAgentClick(
    window: BrowserWindow,
    id: string,
    ref: string,
  ): Promise<PreparedBrowserAction> {
    const entry = this.#agentSurface(window, id)
    if (!entry) throw new StaleBrowserReference()
    const verifyDocument = entry.references.documentGuard()
    const target = await this.agentElement(window, id, ref)
    verifyDocument()
    const context = {
      kind: "click" as const,
      url: target.url,
      ref,
      role: target.role,
      name: target.name,
    }
    return preparedBrowserAction(context, (signal) =>
      this.#runAgentAction(id, entry, context, 10_000, signal, async (control) => {
        const verifyTarget = () => {
          if (this.#agentSurface(window, id) !== entry || !isAgentBrowserAddress(target.url))
            throw new StaleBrowserReference()
          verifyDocument()
        }
        verifyTarget()
        this.#send(window, { type: "browser-open", id, url: target.url })
        await clickBrowserPoint(
          entry.view.webContents,
          () => entry.references.clickPoint(target),
          verifyTarget,
          control,
        )
      }),
    )
  }

  /** 只为当前会话的 Agent 标签准备截图审批；批准后才读取像素。 */
  prepareAgentScreenshot(
    window: BrowserWindow,
    id: string,
    signal?: AbortSignal,
    canUse: () => boolean = () => true,
  ): Promise<PreparedBrowserScreenshot> {
    const entry = this.#surfaces.get(id)
    const missingPage = "Open a local page in this session before requesting a screenshot."
    if (entry?.window !== window || !entry.agent)
      return Promise.reject(new BrowserScreenshotError(missingPage))
    const assertScope = () => {
      if (
        !canUse() ||
        window.isDestroyed() ||
        entry.error ||
        entry.crashed ||
        this.#surfaces.get(id) !== entry ||
        entry.view.webContents.isDestroyed()
      )
        throw new BrowserScreenshotError(missingPage)
    }
    return prepareBrowserScreenshot(
      entry.view.webContents,
      assertScope,
      () => browserViewPixelSize(window, entry.view),
      (validate, invocation) =>
        captureBrowserView(window, entry.view, () => entry.attached, validate, invocation),
      signal,
    )
  }

  /** 执行白名单中的浏览器导航命令。 */
  command(window: BrowserWindow, id: string, action: WorkbenchBrowserAction): void {
    const entry = this.#surfaces.get(id)
    if (entry?.window !== window) return
    const contents = entry.view.webContents
    if (action === "back" && contents.navigationHistory.canGoBack())
      contents.navigationHistory.goBack()
    if (action === "forward" && contents.navigationHistory.canGoForward())
      contents.navigationHistory.goForward()
    if (action === "reload") {
      const retry = entry.error?.url
      if (retry) void this.navigate(window, id, retry)
      else {
        entry.crashed = undefined
        contents.reload()
      }
    }
    if (action === "stop") contents.stop()
    if (action === "devtools") contents.openDevTools({ mode: "detach" })
  }

  /** 将标签画在可信的内容区域，隐藏时把原生子视图从窗口移开。 */
  present(window: BrowserWindow, id: string, bounds: WorkbenchBrowserBounds | null): void {
    if (!bounds) {
      const entry = this.#surfaces.get(id)
      if (entry?.window === window && entry.attached) {
        entry.pickVersion += 1
        entry.attached = false
        window.contentView.removeChildView(entry.view)
      }
      return
    }
    const entry = this.#surfaces.get(id)
    if (entry?.window !== window) return
    const size = window.getContentBounds()
    const x = Math.min(Math.max(0, bounds.x), size.width)
    const y = Math.min(Math.max(0, bounds.y), size.height)
    entry.view.setBounds({
      x,
      y,
      width: Math.min(bounds.width, size.width - x),
      height: Math.min(bounds.height, size.height - y),
    })
    if (entry.scale !== bounds.scale) {
      entry.view.webContents.setZoomFactor(bounds.scale)
      entry.scale = bounds.scale
    }
    if (!entry.attached) {
      releaseBrowserCaptureView(entry.view)
      window.contentView.addChildView(entry.view)
      entry.attached = true
      this.#publish(id, entry)
    }
  }

  /** 用户主动选择页面元素时只提取标识和文本，交由聊天输入框显式发送。 */
  async pick(window: BrowserWindow, id: string): Promise<void> {
    const entry = this.#surfaces.get(id)
    if (entry?.window !== window || !entry.attached) return
    const contents = entry.view.webContents
    const url = contents.getURL()
    if (!allowsWorkbenchBrowserAddress(url)) return
    const version = ++entry.pickVersion
    const selected = await pickWorkbenchBrowserElement(contents)
    if (
      this.#surfaces.get(id) !== entry ||
      version !== entry.pickVersion ||
      url !== contents.getURL()
    )
      return
    if (!selected) return
    this.#send(window, {
      type: "browser-context",
      id,
      element: { url, ...selected },
    })
  }

  /** 从主窗口移除并销毁指定标签的 Chromium 内容。 */
  close(window: BrowserWindow, id: string): void {
    const entry = this.#surfaces.get(id)
    if (entry?.window !== window) return
    this.#surfaces.delete(id)
    releaseBrowserCaptureView(entry.view)
    if (!window.isDestroyed() && entry.attached) window.contentView.removeChildView(entry.view)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    if (entry.agent) {
      this.#send(window, { type: "browser-close", id })
      void agentSession(id)
        .clearStorageData()
        .catch(() => undefined)
    }
  }

  /** 关闭一个会话的 Agent 浏览器并清空它的分区数据；这个会话没开过浏览器时什么也不做。 */
  closeAgent(id: string): void {
    const entry = this.#surfaces.get(id)
    if (!entry?.agent) return
    this.close(entry.window, id)
  }

  /** 关闭属于该主窗口的标签和独立预览。 */
  closeWindow(window: BrowserWindow): void {
    for (const id of this.#surfaces.keys()) this.close(window, id)
    this.#previews.closeWindow(window)
  }

  /** 在独立沙箱窗口预览本机开发地址。 */
  preview(window: BrowserWindow, input: unknown): Promise<{ id: string }> {
    return this.#previews.open(window, input)
  }

  /** 只将显式的 HTTP(S) 地址交给系统浏览器。 */
  async external(input: unknown): Promise<void> {
    await shell.openExternal(workbenchBrowserUrl(input).href)
  }

  #agentSurface(window: BrowserWindow, id: string): AgentSurface | undefined {
    const entry = this.#surfaces.get(id)
    if (window.isDestroyed()) throw new StaleBrowserReference()
    if (!entry) return
    if (entry.window !== window || !isAgentSurface(entry) || entry.view.webContents.isDestroyed())
      throw new StaleBrowserReference()
    return entry
  }

  async #runAgentAction(
    id: string,
    entry: AgentSurface,
    context: PreparedBrowserAction["context"],
    timeout: number,
    signal: AbortSignal | undefined,
    run: (control: AbortSignal) => Promise<void>,
  ): Promise<string> {
    if (this.#agentSurface(entry.window, id) !== entry) throw new StaleBrowserReference()
    if (entry.activity)
      throw new BrowserActionError("Another approved browser action is still running.")
    const deadline = AbortSignal.timeout(timeout)
    const control = signal ? AbortSignal.any([signal, deadline]) : deadline
    assertBrowserActionActive(control)
    entry.activity = {
      kind: context.kind,
      target: context.kind === "navigate" ? context.url : context.name || context.ref,
    }
    try {
      this.#publish(id, entry)
      await awaitBrowserAction(run(control), control)
      assertBrowserActionActive(control)
      if (this.#agentSurface(entry.window, id) !== entry) throw new StaleBrowserReference()
      const snapshot = await awaitBrowserAction(this.agentPage(entry.window, id), control)
      if (this.#agentSurface(entry.window, id) !== entry) throw new StaleBrowserReference()
      return snapshot
    } catch (error) {
      if (error instanceof BrowserActionError) throw error
      throw new BrowserActionError(
        "The browser could not complete the approved action. Please take a new browser snapshot.",
      )
    } finally {
      delete entry.activity
      this.#publish(id, entry)
    }
  }

  #entry(window: BrowserWindow, id: string, agent = false): Surface {
    const existing = this.#surfaces.get(id)
    if (existing?.window === window) {
      if (agent && existing.agent === null) throw new Error("WORKBENCH_PREVIEW_FAILED")
      return existing
    }
    if (existing || this.#surfaces.size >= maxBrowsers) throw new Error("WORKBENCH_BROWSER_LIMIT")
    const partition = agent ? agentSession(id) : browserSession()
    const network = agent ? installAgentBrowserNetwork(partition) : null
    const view = new WebContentsView({
      webPreferences: {
        session: partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    const contents = view.webContents
    const entry: Surface = {
      window,
      view,
      pickVersion: 0,
      attached: false,
      scale: 1,
      agent: network,
      references: network ? new BrowserReferences(contents) : null,
    }
    this.#surfaces.set(id, entry)
    configureContents(contents, agent, network ?? undefined, (url) => {
      queueMicrotask(() => {
        if (this.#surfaces.get(id) === entry)
          void this.navigate(window, id, url).catch(() => undefined)
      })
    })
    const publish = () => this.#publish(id, entry)
    contents.on("did-finish-load", () => contents.setZoomFactor(entry.scale))
    contents.on("did-start-loading", () => {
      entry.error = undefined
      publish()
    })
    const navigationChanged = () => {
      publish()
      setImmediate(publish)
    }
    contents.on("did-stop-loading", navigationChanged)
    contents.on("did-navigate", navigationChanged)
    contents.on("did-navigate-in-page", navigationChanged)
    contents.on("page-title-updated", publish)
    contents.on("did-fail-load", (_event, code, description, url, mainFrame) => {
      if (!mainFrame || code === -3) return
      entry.error = { code, description, url }
      publish()
    })
    contents.on("render-process-gone", (_event, details) => {
      entry.crashed = { reason: details.reason }
      publish()
    })
    return entry
  }

  #publish(id: string, entry: Surface): void {
    const contents = entry.view.webContents
    if (this.#surfaces.get(id) !== entry || contents.isDestroyed()) return
    this.#send(entry.window, {
      type: "browser-page",
      id,
      page: {
        url: contents.getURL() || entry.error?.url || "",
        title: contents.getTitle(),
        loading: contents.isLoading(),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.crashed ? { crashed: entry.crashed } : {}),
        ...(entry.activity ? { activity: entry.activity } : {}),
      },
    })
  }

  #send(window: BrowserWindow, event: WorkbenchEvent): void {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("pigclaude:workbench-event", event)
    }
  }
}
