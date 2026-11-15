// 内置浏览器使用独立沙箱和 WebContentsView，页面没有桌面 preload 或 Node 能力。
import { WebContentsView, shell, type BrowserWindow, type Session } from "electron"
import type { BrowserNavigationTarget, BrowserTypeInput } from "../../browser-permission-contract"
import { agentBrowserIdPrefix } from "../../workbench-contract"
import type {
  AgentBrowserScope,
  AgentBrowserTab,
  WorkbenchBrowserAction,
  WorkbenchBrowserActivity,
  WorkbenchBrowserBounds,
  WorkbenchBrowserPage,
  WorkbenchEvent,
} from "../../workbench-contract"
import { AgentBrowserActions } from "./agent-browser-actions"
import {
  installAgentBrowserNetwork,
  isAgentBrowserAddress,
  type AgentBrowserNetwork,
} from "./agent-browser-network"
import type { PreparedBrowserAction } from "./browser-action-request"
import {
  agentSession,
  allowsWorkbenchBrowserAddress,
  applyWorkbenchBrowserBounds,
  browserSession,
  configureContents,
  workbenchAgentBrowserUrl,
  workbenchBrowserPage,
  workbenchBrowserUrl,
} from "./browser-context"
import { pickWorkbenchBrowserElement } from "./browser-element-picker"
import { WorkbenchBrowserPreviews } from "./browser-preview"
import {
  BrowserReferences,
  StaleBrowserReference,
  type AgentBrowserElement,
} from "./browser-references"
import { releaseBrowserCaptureView, type PreparedBrowserScreenshot } from "./browser-screenshot"

export { workbenchAgentBrowserUrl, workbenchBrowserUrl } from "./browser-context"

const maxBrowsers = 12
type Surface = {
  window: BrowserWindow
  view: WebContentsView
  error?: WorkbenchBrowserPage["error"]
  crashed?: WorkbenchBrowserPage["crashed"]
  activity?: WorkbenchBrowserActivity
  pickVersion: number
  agent: {
    sessionId: string
    network: AgentBrowserNetwork
    partition: Session
    opened: boolean
    references: BrowserReferences
  } | null
  attached: boolean
  scale: number
}

/** 带有确定会话所有权和引用表的 Agent 标签。 */
export type AgentBrowserSurface = Surface & { agent: NonNullable<Surface["agent"]> }

/** 管理浏览器标签和本机预览窗口；内容尺寸由受信主窗口报告。 */
export class WorkbenchBrowsers {
  readonly #surfaces = new Map<string, Surface>()
  readonly #previews = new WorkbenchBrowserPreviews()
  readonly #activeSessions = new Map<BrowserWindow, string>()
  readonly #clearing = new Map<string, Promise<void>>()
  readonly #actions = new AgentBrowserActions({
    current: (window, scope) => {
      const entry = this.#ownedView(window, scope.id, scope.sessionId, false)
      return entry?.agent && this.#isLive(scope.id, entry)
        ? (entry as AgentBrowserSurface)
        : undefined
    },
    create: (window, scope) =>
      this.#entry(window, scope.id, scope.sessionId) as AgentBrowserSurface,
    open: (scope, entry, url) => this.#openAgent(scope, entry, url),
    publish: (id, entry) => this.#publish(id, entry),
    snapshot: (window, scope) => this.agentPage(window, scope),
  })

  /** 记住窗口正在显示的会话，并立即移开其他会话的 Agent 子视图。 */
  setActiveSession(window: BrowserWindow, sessionId: string | null): void {
    if (sessionId === null) this.#activeSessions.delete(window)
    else this.#activeSessions.set(window, sessionId)
    for (const entry of this.#surfaces.values()) {
      if (entry.window === window && entry.agent && entry.agent.sessionId !== sessionId)
        this.#detach(entry)
    }
  }

  /** 只返回该窗口、该会话中已经打开的 Agent 标签。 */
  listAgentTabs(window: BrowserWindow, sessionId: string): AgentBrowserTab[] {
    return [...this.#surfaces].flatMap(([id, entry]) =>
      entry.window === window &&
      entry.agent?.sessionId === sessionId &&
      entry.agent.opened &&
      !entry.view.webContents.isDestroyed()
        ? [{ id, sessionId, page: this.#page(entry) }]
        : [],
    )
  }

  /** 用户从 Agent 标签打开独立预览或系统浏览器时，也必须仍在该标签所属会话中。 */
  requireActiveAgent(window: BrowserWindow, scope: AgentBrowserScope): void {
    if (!this.#ownedView(window, scope.id, scope.sessionId))
      throw new Error("WORKBENCH_PREVIEW_FAILED")
  }

  /** 打开指定标签的地址，保留该标签的导航历史。 */
  async navigate(
    window: BrowserWindow,
    id: string,
    input: unknown,
    sessionId?: string,
  ): Promise<void> {
    const url = workbenchBrowserUrl(input)
    const entry =
      sessionId === undefined && !id.startsWith(agentBrowserIdPrefix)
        ? this.#entry(window, id)
        : this.#ownedView(window, id, sessionId)
    if (!entry) throw new Error("WORKBENCH_PREVIEW_FAILED")
    await this.#navigate(id, entry, url)
  }

  async #navigate(id: string, entry: Surface, url: URL, assertAllowed?: () => void): Promise<void> {
    if (entry.agent && !isAgentBrowserAddress(url.href)) throw new Error("PREVIEW_URL_NOT_ALLOWED")
    await entry.agent?.network.ready
    if (!this.#isLive(id, entry)) return
    assertAllowed?.()
    entry.error = undefined
    entry.crashed = undefined
    entry.pickVersion += 1
    entry.agent?.references.invalidate()
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
  async agentPage(
    window: BrowserWindow,
    { id, sessionId }: AgentBrowserScope,
    input?: string,
    assertAllowed?: () => void,
  ): Promise<string> {
    assertAllowed?.()
    if (input !== undefined) {
      const url = workbenchAgentBrowserUrl(input)
      const entry = this.#entry(window, id, sessionId)
      await this.#navigate(id, entry, url, assertAllowed)
      if (!this.#isLive(id, entry) || entry.error || !entry.agent)
        throw new Error("WORKBENCH_PREVIEW_FAILED")
      this.#openAgent({ id, sessionId }, entry as AgentBrowserSurface, url.href)
    }
    const entry = this.#ownedView(window, id, sessionId, false)
    if (!entry?.agent || entry.error || !this.#isLive(id, entry))
      throw new Error("WORKBENCH_PREVIEW_FAILED")
    const contents = entry.view.webContents
    const current = workbenchBrowserUrl(contents.getURL())
    if (!isAgentBrowserAddress(current.href)) throw new Error("PREVIEW_URL_NOT_ALLOWED")
    const snapshot =
      input === undefined
        ? await entry.agent.references.snapshot()
        : {
            text: (await contents.executeJavaScriptInIsolatedWorld(1001, [
              { code: "(document.body?.innerText ?? '').trim().slice(0, 6000)" },
            ])) as unknown,
          }
    if (!this.#isLive(id, entry) || current.href !== contents.getURL())
      throw new Error("WORKBENCH_PREVIEW_FAILED")
    assertAllowed?.()
    return JSON.stringify({
      url: current.href,
      title: contents.getTitle(),
      ...snapshot,
      text: typeof snapshot.text === "string" ? snapshot.text : "",
      blockedRequests: entry.agent.network.blockedRequests,
    })
  }

  /** 用当前 Agent 标签的引用表读取元素；页面已导航或引用无效时提示重新快照。 */
  async agentElement(
    window: BrowserWindow,
    { id, sessionId }: AgentBrowserScope,
    ref: string,
  ): Promise<AgentBrowserElement & { url: string }> {
    const entry = this.#ownedView(window, id, sessionId, false)
    if (!entry?.agent || entry.error || !this.#isLive(id, entry)) throw new StaleBrowserReference()
    const contents = entry.view.webContents
    const url = contents.getURL()
    if (!isAgentBrowserAddress(url)) throw new StaleBrowserReference()
    const element = await entry.agent.references.resolve(ref)
    if (!this.#isLive(id, entry) || url !== contents.getURL()) throw new StaleBrowserReference()
    return { ...element, url }
  }

  /** 解析当前会话的 Agent 导航目标。 */
  async prepareAgentNavigation(
    window: BrowserWindow,
    scope: AgentBrowserScope,
    target: BrowserNavigationTarget,
  ): Promise<PreparedBrowserAction> {
    return this.#actions.prepareNavigation(window, scope, target)
  }

  /** 解析当前会话的真实交互元素，点击须由该次批准解锁。 */
  prepareAgentClick(
    window: BrowserWindow,
    scope: AgentBrowserScope,
    ref: string,
  ): Promise<PreparedBrowserAction> {
    return this.#actions.prepareClick(window, scope, ref)
  }

  /** 核验对应会话的可输入目标，批准后只向同一文档写入。 */
  prepareAgentType(
    window: BrowserWindow,
    scope: AgentBrowserScope,
    input: BrowserTypeInput,
  ): Promise<PreparedBrowserAction> {
    return this.#actions.prepareType(window, scope, input)
  }

  /** 读取当前会话的 Agent 标签截图尺寸，批准后才读取像素。 */
  prepareAgentScreenshot(
    window: BrowserWindow,
    scope: AgentBrowserScope,
    signal?: AbortSignal,
    canUse?: () => boolean,
  ): Promise<PreparedBrowserScreenshot> {
    return this.#actions.prepareScreenshot(window, scope, signal, canUse)
  }

  /** 执行白名单中的浏览器导航命令。 */
  command(
    window: BrowserWindow,
    id: string,
    action: WorkbenchBrowserAction,
    sessionId?: string,
  ): void {
    const entry = this.#ownedView(window, id, sessionId)
    if (!entry) return
    const contents = entry.view.webContents
    if (action === "back" && contents.navigationHistory.canGoBack())
      contents.navigationHistory.goBack()
    if (action === "forward" && contents.navigationHistory.canGoForward())
      contents.navigationHistory.goForward()
    if (action === "reload") {
      const retry = entry.error?.url
      if (retry) void this.navigate(window, id, retry, sessionId).catch(() => undefined)
      else {
        entry.crashed = undefined
        contents.reload()
      }
    }
    if (action === "stop") contents.stop()
    if (action === "devtools") contents.openDevTools({ mode: "detach" })
  }

  /** 将标签画在可信的内容区域，隐藏时把原生子视图从窗口移开。 */
  present(
    window: BrowserWindow,
    id: string,
    bounds: WorkbenchBrowserBounds | null,
    sessionId?: string,
  ): void {
    const entry = this.#ownedView(window, id, sessionId, bounds !== null)
    if (!entry) return
    if (!bounds) {
      this.#detach(entry)
      return
    }
    entry.scale = applyWorkbenchBrowserBounds(
      entry.view,
      window.getContentBounds(),
      bounds,
      entry.scale,
    )
    if (!entry.attached) {
      releaseBrowserCaptureView(entry.view)
      window.contentView.addChildView(entry.view)
      entry.attached = true
      this.#publish(id, entry)
    }
  }

  /** 用户主动选择页面元素时只提取标识和文本，交由聊天输入框显式发送。 */
  async pick(window: BrowserWindow, id: string, sessionId?: string): Promise<void> {
    const entry = this.#ownedView(window, id, sessionId)
    if (!entry?.attached) return
    const contents = entry.view.webContents
    const url = contents.getURL()
    if (!allowsWorkbenchBrowserAddress(url, false)) return
    const version = ++entry.pickVersion
    const selected = await pickWorkbenchBrowserElement(contents)
    if (
      !selected ||
      this.#ownedView(window, id, sessionId) !== entry ||
      version !== entry.pickVersion ||
      url !== contents.getURL()
    )
      return
    this.#send(window, {
      type: "browser-context",
      id,
      ...(entry.agent ? { sessionId: entry.agent.sessionId } : {}),
      element: { url, ...selected },
    })
  }

  /** 从主窗口移除并销毁指定标签的 Chromium 内容。 */
  async close(window: BrowserWindow, id: string, sessionId?: string): Promise<void> {
    const entry = this.#ownedView(window, id, sessionId)
    if (entry) await this.#closeSurface(id, entry)
  }

  async #closeSurface(id: string, entry: Surface): Promise<void> {
    this.#surfaces.delete(id)
    releaseBrowserCaptureView(entry.view)
    this.#detach(entry)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    const agent = entry.agent
    if (!agent) return
    this.#send(entry.window, { type: "browser-close", id, sessionId: agent.sessionId })
    const clearing = Promise.allSettled([
      agent.partition.clearStorageData(),
      agent.partition.clearCache(),
    ]).then(() => {
      this.#clearing.delete(id)
    })
    this.#clearing.set(id, clearing)
    await clearing
  }

  /** 关闭一个会话的 Agent 浏览器并清空它的分区数据；这个会话没开过浏览器时什么也不做。 */
  async closeAgent(id: string): Promise<void> {
    const entry = this.#surfaces.get(id)
    if (entry?.agent) await this.#closeSurface(id, entry)
    else await this.#clearing.get(id)
  }

  /** 关闭属于该主窗口的标签和独立预览。 */
  async closeWindow(window: BrowserWindow): Promise<void> {
    this.#activeSessions.delete(window)
    this.#previews.closeWindow(window)
    await Promise.all(
      [...this.#surfaces].flatMap(([id, entry]) =>
        entry.window === window ? [this.#closeSurface(id, entry)] : [],
      ),
    )
  }

  /** 在独立沙箱窗口预览本机开发地址。 */
  preview(window: BrowserWindow, input: unknown): Promise<{ id: string }> {
    return this.#previews.open(window, input)
  }

  /** 只将显式的 HTTP(S) 地址交给系统浏览器。 */
  async external(input: unknown): Promise<void> {
    await shell.openExternal(workbenchBrowserUrl(input).href)
  }

  #ownedView(
    window: BrowserWindow,
    id: string,
    sessionId?: string,
    visible = true,
  ): Surface | undefined {
    const entry = this.#surfaces.get(id)
    return entry?.window === window &&
      entry.agent?.sessionId === sessionId &&
      (!visible || sessionId === undefined || this.#activeSessions.get(window) === sessionId)
      ? entry
      : undefined
  }

  #detach(entry: Surface): void {
    if (!entry.attached) return
    entry.pickVersion += 1
    entry.attached = false
    if (!entry.window.isDestroyed()) entry.window.contentView.removeChildView(entry.view)
  }

  #isLive(id: string, entry: Surface): boolean {
    return (
      this.#surfaces.get(id) === entry &&
      !entry.window.isDestroyed() &&
      !entry.view.webContents.isDestroyed()
    )
  }

  #entry(window: BrowserWindow, id: string, sessionId?: string): Surface {
    const existing = this.#surfaces.get(id)
    if (existing?.window === window && existing.agent?.sessionId === sessionId) return existing
    if (
      existing ||
      this.#clearing.has(id) ||
      id.startsWith(agentBrowserIdPrefix) !== (sessionId !== undefined)
    )
      throw new Error("WORKBENCH_PREVIEW_FAILED")
    if (this.#surfaces.size + this.#clearing.size >= maxBrowsers)
      throw new Error("WORKBENCH_BROWSER_LIMIT")
    const partition = sessionId === undefined ? browserSession() : agentSession(id)
    const agent =
      sessionId === undefined
        ? null
        : {
            sessionId,
            network: installAgentBrowserNetwork(partition),
            partition,
            opened: false,
          }
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
      agent: agent ? { ...agent, references: new BrowserReferences(contents) } : null,
    }
    this.#surfaces.set(id, entry)
    configureContents(contents, agent !== null, agent?.network, (url) => {
      queueMicrotask(() => {
        if (this.#isLive(id, entry))
          void this.#navigate(id, entry, workbenchAgentBrowserUrl(url)).catch(() => undefined)
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
    if (!this.#isLive(id, entry)) return
    this.#send(entry.window, {
      type: "browser-page",
      id,
      ...(entry.agent ? { sessionId: entry.agent.sessionId } : {}),
      page: this.#page(entry),
    })
  }

  #page(entry: Surface): WorkbenchBrowserPage {
    return workbenchBrowserPage(entry.view.webContents, entry)
  }

  #openAgent(scope: AgentBrowserScope, entry: AgentBrowserSurface, url: string): void {
    entry.agent.opened = true
    this.#send(entry.window, { type: "browser-open", ...scope, url })
  }

  #send(window: BrowserWindow, event: WorkbenchEvent): void {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("pigclaude:workbench-event", event)
    }
  }
}
