// 把真实浏览器管理器接到假的 Electron 原生窗口，验证多会话归属、分区回收和并发配额。

import { randomUUID } from "node:crypto"
import type { BrowserWindow } from "electron"
import { beforeEach, expect, it, vi } from "vitest"
import type { AgentBrowserScope, WorkbenchEvent } from "../../workbench-contract"
import { configureAgentBrowserRuntime } from "./agent-browser-network"
import { WorkbenchBrowsers } from "./browser-surface"

const native = vi.hoisted(() => ({
  views: [] as Array<{
    contents: {
      reload: () => void
      setZoomFactor: (scale: number) => void
      session: { clearStorageData: () => Promise<void>; clearCache: () => Promise<void> }
      isDestroyed: () => boolean
    }
  }>,
  load: new Map<string, Promise<void>>(),
  navigating: new Set<string>(),
}))

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")

  class Partition extends EventEmitter {
    clearStorageData = vi.fn(async () => undefined)
    clearCache = vi.fn(async () => undefined)
    webRequest = {
      onBeforeRequest() {},
      onBeforeSendHeaders() {},
      onHeadersReceived() {},
    }
    setPermissionRequestHandler() {}
    setPermissionCheckHandler() {}
    async setProxy() {}
  }

  class Contents extends EventEmitter {
    #destroyed = false
    #url = ""
    reload = vi.fn()
    setZoomFactor = vi.fn()
    navigationHistory = { canGoBack: () => false, canGoForward: () => false }

    constructor(readonly session: Partition) {
      super()
    }

    async loadURL(url: string) {
      native.navigating.add(url)
      await native.load.get(url)
      this.#url = url
      this.emit("did-navigate")
    }

    getURL() {
      return this.#url
    }
    getTitle() {
      return this.#url
    }
    isDestroyed() {
      return this.#destroyed
    }
    isLoading() {
      return false
    }
    setWindowOpenHandler() {}
    setWebRTCIPHandlingPolicy() {}
    close() {
      this.#destroyed = true
    }
    async executeJavaScriptInIsolatedWorld() {
      return `内容：${this.#url}`
    }
  }

  class View {
    readonly webContents: Contents

    constructor({ webPreferences }: { webPreferences: { session: Partition } }) {
      this.webContents = new Contents(webPreferences.session)
      native.views.push({ contents: this.webContents })
    }

    setBounds() {}
  }

  const partitions = new Map<string, Partition>()
  return {
    BrowserWindow: class {},
    WebContentsView: View,
    session: {
      fromPartition(name: string) {
        const value = partitions.get(name) ?? new Partition()
        partitions.set(name, value)
        return value
      },
    },
    shell: {},
  }
})

const bounds = { x: 0, y: 0, width: 100, height: 100, scale: 1 }

function fixture() {
  const events: WorkbenchEvent[] = []
  const attached = new Set<unknown>()
  const window = {
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 800, height: 600 }),
    contentView: {
      addChildView: (view: unknown) => attached.add(view),
      removeChildView: (view: unknown) => attached.delete(view),
    },
    webContents: {
      isDestroyed: () => false,
      send: (_name: string, event: WorkbenchEvent) => events.push(event),
    },
  } as unknown as BrowserWindow
  return { browsers: new WorkbenchBrowsers(), window, events, attached }
}

function scope(sessionId: string): AgentBrowserScope {
  return { sessionId, id: "agent-" + randomUUID() }
}

beforeEach(() => {
  configureAgentBrowserRuntime({ appendSwitch: () => undefined, getSwitchValue: () => "" })
  native.views.length = 0
  native.load.clear()
  native.navigating.clear()
})

it("打开两个会话的独立浏览器，切换时只能显示并操作当前会话", async () => {
  const { browsers, window, events, attached } = fixture()
  const first = scope("session-a")
  const second = scope("session-b")
  const firstUrl = "http://127.0.0.1:3001/"
  const secondUrl = "http://localhost:3002/"
  await Promise.all([
    browsers.agentPage(window, first, firstUrl),
    browsers.agentPage(window, second, secondUrl),
  ])

  expect(events.filter((event) => event.type === "browser-open")).toEqual(
    expect.arrayContaining([
      { type: "browser-open", ...first, url: firstUrl },
      { type: "browser-open", ...second, url: secondUrl },
    ]),
  )
  expect(browsers.listAgentTabs(window, first.sessionId).map(({ id }) => id)).toEqual([first.id])
  expect(browsers.listAgentTabs(window, second.sessionId).map(({ id }) => id)).toEqual([second.id])
  expect(native.views[0]?.contents.session).not.toBe(native.views[1]?.contents.session)

  browsers.setActiveSession(window, first.sessionId)
  browsers.present(window, first.id, bounds, first.sessionId)
  expect(attached.size).toBe(1)
  browsers.command(window, second.id, "reload", second.sessionId)
  browsers.command(window, second.id, "reload", first.sessionId)
  await expect(browsers.navigate(window, second.id, secondUrl, second.sessionId)).rejects.toThrow(
    "WORKBENCH_PREVIEW_FAILED",
  )
  expect(native.views[1]?.contents.reload).not.toHaveBeenCalled()

  browsers.setActiveSession(window, second.sessionId)
  expect(attached.size).toBe(0)
  browsers.present(window, first.id, bounds, first.sessionId)
  expect(attached.size).toBe(0)
  browsers.present(window, second.id, bounds, second.sessionId)
  expect(attached.size).toBe(1)
  browsers.command(window, second.id, "reload", second.sessionId)
  expect(native.views[1]?.contents.reload).toHaveBeenCalledOnce()

  await browsers.closeAgent(second.id)
  expect(attached.size).toBe(0)
  expect(native.views[1]?.contents.isDestroyed()).toBe(true)
  expect(native.views[1]?.contents.session.clearStorageData).toHaveBeenCalledOnce()
  expect(native.views[1]?.contents.session.clearCache).toHaveBeenCalledOnce()
  expect(native.views[0]?.contents.session.clearStorageData).not.toHaveBeenCalled()
  expect(events).toContainEqual({ type: "browser-close", ...second })
  await expect(browsers.navigate(window, second.id, secondUrl)).rejects.toThrow(
    "WORKBENCH_PREVIEW_FAILED",
  )

  const resumed = scope(second.sessionId)
  expect(browsers.listAgentTabs(window, resumed.sessionId)).toEqual([])
  await browsers.agentPage(window, resumed, secondUrl)
  expect(browsers.listAgentTabs(window, resumed.sessionId).map(({ id }) => id)).toEqual([
    resumed.id,
  ])
  expect(native.views[2]?.contents.session).not.toBe(native.views[1]?.contents.session)
})

it("停止正在导航的会话后，迟到的原生事件不能重新打开标签", async () => {
  const { browsers, window, events } = fixture()
  const first = scope("session-a")
  const url = "http://localhost:3003/"
  let unblock = () => {}
  native.load.set(
    url,
    new Promise<void>((resolve) => {
      unblock = resolve
    }),
  )
  const opening = browsers.agentPage(window, first, url)
  const outcome = expect(opening).rejects.toThrow("WORKBENCH_PREVIEW_FAILED")
  await vi.waitFor(() => expect(native.navigating.has(url)).toBe(true))
  await browsers.closeAgent(first.id)
  unblock()
  await outcome

  expect(events.filter((event) => event.type === "browser-open")).toEqual([])
  expect(browsers.listAgentTabs(window, first.sessionId)).toEqual([])
  expect(native.views[0]?.contents.session.clearStorageData).toHaveBeenCalledOnce()
})

it("所有会话共用 12 个实际浏览器的上限，回收后允许再开", async () => {
  const { browsers, window } = fixture()
  const sessions = Array.from({ length: 12 }, (_, index) => scope(`session-${index}`))
  const url = "http://localhost:3001/"
  await Promise.all(sessions.map((owner) => browsers.agentPage(window, owner, url)))
  const next = scope("next")
  await expect(browsers.agentPage(window, next, url)).rejects.toThrow("WORKBENCH_BROWSER_LIMIT")
  await browsers.closeAgent(sessions[0]?.id ?? "")
  await expect(browsers.agentPage(window, next, url)).resolves.toContain(url)
  expect(native.views).toHaveLength(13)
})
