// 内置浏览器使用独立沙箱和 WebContentsView，页面没有桌面 preload 或 Node 能力。
import { BrowserWindow, WebContentsView, session, shell, type WebContents } from "electron"
import { randomUUID } from "node:crypto"
import type {
  WorkbenchBrowserAction,
  WorkbenchBrowserBounds,
  WorkbenchBrowserElement,
  WorkbenchBrowserPage,
  WorkbenchEvent,
} from "../../workbench-contract"
import {
  installAgentBrowserNetwork,
  isAgentBrowserAddress,
  type AgentBrowserNetwork,
} from "./agent-browser-network"
import {
  BrowserReferences,
  StaleBrowserReference,
  type AgentBrowserElement,
} from "./browser-references"

const partition = "persist:pigclaude-workbench-browser"
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"])
const maxBrowsers = 12
type Surface = {
  window: BrowserWindow
  view: WebContentsView
  error?: WorkbenchBrowserPage["error"]
  crashed?: WorkbenchBrowserPage["crashed"]
  pickVersion: number
  agent: AgentBrowserNetwork | null
  references: BrowserReferences | null
  attached: boolean
  scale: number
}

/** 解析允许的浏览器地址，只接受不带内嵌凭据的 HTTP 或 HTTPS。 */
export function workbenchBrowserUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 4096) throw new Error("URL_NOT_ALLOWED")
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("URL_NOT_ALLOWED")
  }
  return url
}

/** Agent 浏览器在申请审批和打开页面前都使用既有的回环地址限制。 */
export function workbenchAgentBrowserUrl(value: unknown): URL {
  const url = workbenchBrowserUrl(value)
  if (!isAgentBrowserAddress(url.href)) throw new Error("PREVIEW_URL_NOT_ALLOWED")
  return url
}

function allowed(target: string, local: boolean): boolean {
  try {
    const url = workbenchBrowserUrl(target)
    return !local || loopback.has(url.hostname)
  } catch {
    return false
  }
}

function configureContents(
  contents: WebContents,
  local = false,
  agent?: AgentBrowserNetwork,
  openInSameTab?: (url: string) => void,
): void {
  if (agent) contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")
  function canNavigate(target: string, isFrame = false): boolean {
    if (agent) return (isFrame && target === "about:srcdoc") || isAgentBrowserAddress(target)
    return (isFrame && target === "about:blank") || allowed(target, local)
  }
  contents.on("will-navigate", (event) => {
    if (!canNavigate(event.url)) {
      agent?.markBlocked()
      event.preventDefault()
    }
  })
  contents.on("will-redirect", (event) => {
    if (!canNavigate(event.url, !event.isMainFrame)) {
      agent?.markBlocked()
      event.preventDefault()
    }
  })
  contents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame && !canNavigate(event.url, true)) {
      agent?.markBlocked()
      event.preventDefault()
    }
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (agent && isAgentBrowserAddress(url)) openInSameTab?.(url)
    else agent?.markBlocked()
    return { action: "deny" }
  })
}

function browserSession() {
  return restrictedSession(partition)
}

function agentSession(id: string) {
  return restrictedSession("pigclaude-workbench-agent-" + id)
}

function restrictedSession(name: string) {
  const value = session.fromPartition(name)
  value.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  value.setPermissionCheckHandler(() => false)
  return value
}

/** 管理浏览器标签和本机预览窗口；内容尺寸由受信主窗口报告。 */
export class WorkbenchBrowsers {
  readonly #surfaces = new Map<string, Surface>()
  readonly #previews = new Map<BrowserWindow, BrowserWindow>()

  /** 打开指定标签的地址，保留该标签的导航历史。 */
  async navigate(window: BrowserWindow, id: string, input: unknown): Promise<void> {
    const url = workbenchBrowserUrl(input)
    const entry = this.#entry(window, id)
    if (entry.agent && !isAgentBrowserAddress(url.href)) throw new Error("PREVIEW_URL_NOT_ALLOWED")
    await entry.agent?.ready
    entry.error = undefined
    entry.crashed = undefined
    entry.pickVersion += 1
    entry.references?.invalidate()
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
    if (!allowed(url, false)) return
    const version = ++entry.pickVersion
    contents.focus()
    const result: unknown = await contents.executeJavaScriptInIsolatedWorld(
      1001,
      [{ code: elementPicker }],
      true,
    )
    if (
      this.#surfaces.get(id) !== entry ||
      version !== entry.pickVersion ||
      url !== contents.getURL()
    )
      return
    if (typeof result !== "object" || result === null) return
    const selected = result as Partial<WorkbenchBrowserElement>
    if (typeof selected.selector !== "string" || typeof selected.text !== "string") return
    this.#send(window, {
      type: "browser-context",
      id,
      element: {
        url,
        selector: selected.selector.slice(0, 500),
        text: selected.text.slice(0, 1000),
      },
    })
  }

  /** 从主窗口移除并销毁指定标签的 Chromium 内容。 */
  close(window: BrowserWindow, id: string): void {
    const entry = this.#surfaces.get(id)
    if (entry?.window !== window) return
    this.#surfaces.delete(id)
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
    for (const [preview, owner] of this.#previews) if (owner === window) preview.destroy()
  }

  /** 在独立沙箱窗口预览本机开发地址。 */
  async preview(window: BrowserWindow, input: unknown): Promise<{ id: string }> {
    const url = workbenchBrowserUrl(input)
    if (!loopback.has(url.hostname)) throw new Error("PREVIEW_URL_NOT_ALLOWED")
    const preview = new BrowserWindow({
      width: 1100,
      height: 760,
      show: false,
      webPreferences: {
        session: browserSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    this.#previews.set(preview, window)
    preview.once("closed", () => this.#previews.delete(preview))
    configureContents(preview.webContents, true)
    try {
      await preview.loadURL(url.href)
      preview.show()
      return { id: randomUUID() }
    } catch {
      if (!preview.isDestroyed()) preview.destroy()
      throw new Error("WORKBENCH_PREVIEW_FAILED")
    }
  }

  /** 只将显式的 HTTP(S) 地址交给系统浏览器。 */
  async external(input: unknown): Promise<void> {
    await shell.openExternal(workbenchBrowserUrl(input).href)
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
      },
    })
  }

  #send(window: BrowserWindow, event: WorkbenchEvent): void {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("pigclaude:workbench-event", event)
    }
  }
}

const elementPicker = `new Promise((resolve) => {
  const cancelKey = (event) => { if (event.key === "Escape") finish(null) };
  const select = (event) => {
    if (!(event.target instanceof Element)) return finish(null);
    event.preventDefault();
    event.stopImmediatePropagation();
    const element = event.target;
    const path = [];
    for (let item = element; item && path.length < 5; item = item.parentElement) {
      if (item.id) { path.unshift("#" + CSS.escape(item.id)); break; }
      const index = item.parentElement ? Array.from(item.parentElement.children).indexOf(item) + 1 : 1;
      path.unshift(item.localName + ":nth-child(" + index + ")");
    }
    finish({ selector: path.join(" > "), text: (element.textContent || "").trim().slice(0, 1000) });
  };
  const timer = setTimeout(() => finish(null), 15000);
  function finish(value) {
    clearTimeout(timer);
    document.removeEventListener("click", select, true);
    document.removeEventListener("keydown", cancelKey, true);
    resolve(value);
  }
  document.addEventListener("click", select, true);
  document.addEventListener("keydown", cancelKey, true);
})`
