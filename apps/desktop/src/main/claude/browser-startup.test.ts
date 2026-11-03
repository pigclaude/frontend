// 验证授权页面只在浏览器确认扩展状态且启动条件仍成立时打开。

import type { ChildProcess } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { PassThrough } from "node:stream"
import { expect, it, vi } from "vitest"
import { openAuthorizedPage } from "./browser-startup"
import { BrowserProcessExitedError } from "./browser-control-pipe"
import * as extensionPaths from "./browser-extension-paths"

const authorizeUrl = "https://example.test/authorize?state=synthetic"

it("扩展状态确认后才首次打开授权页面", async () => {
  const browser = new SyntheticBrowser()
  try {
    const opening = openAuthorizedPage({ child: browser.child, authorizeUrl })
    await browser.waitForRegistry()
    expect(browser.navigatedUrls()).toEqual(["chrome://extensions/"])
    browser.confirmRegistry()
    await opening
    expect(browser.navigatedUrls()).toEqual(["chrome://extensions/", authorizeUrl])
    expect(browser.closedControlBeforeAuthorization()).toBe(true)
  } finally {
    browser.close()
  }
})

it("浏览器无法确认扩展状态时不打开授权页面", async () => {
  const browser = new SyntheticBrowser()
  try {
    const opening = openAuthorizedPage({ child: browser.child, authorizeUrl })
    await browser.waitForRegistry()
    browser.rejectRegistry()
    await expect(opening).rejects.toThrow("无法确认浏览器扩展状态")
    expect(browser.navigatedUrls()).toEqual(["chrome://extensions/"])
    expect(browser.input.destroyed).toBe(true)
    expect(browser.output.destroyed).toBe(true)
  } finally {
    browser.close()
  }
})

it("等待扩展状态期间取消授权时不打开授权页面", async () => {
  const browser = new SyntheticBrowser()
  const controller = new AbortController()
  try {
    const opening = openAuthorizedPage({
      child: browser.child,
      authorizeUrl,
      signal: controller.signal,
    })
    const outcome = opening.catch((error: unknown) => error)
    await browser.waitForRegistry()
    controller.abort()
    await expect(outcome).resolves.toBeInstanceOf(Error)
    expect(browser.navigatedUrls()).toEqual(["chrome://extensions/"])
    expect(browser.input.destroyed).toBe(true)
    expect(browser.output.destroyed).toBe(true)
  } finally {
    browser.close()
  }
})

it("导航前的启动条件失效时不打开授权页面", async () => {
  const browser = new SyntheticBrowser()
  const unavailable = new Error("synthetic proxy unavailable")
  try {
    const opening = openAuthorizedPage({
      child: browser.child,
      authorizeUrl,
      assertCanNavigate: () => {
        throw unavailable
      },
    })
    const outcome = opening.catch((error: unknown) => error)
    await browser.waitForRegistry()
    browser.confirmRegistry()
    await expect(outcome).resolves.toBe(unavailable)
    expect(browser.navigatedUrls()).toEqual(["chrome://extensions/"])
  } finally {
    browser.close()
  }
})

it("启动期间浏览器退出时保留可识别的退出原因", async () => {
  const browser = new SyntheticBrowser()
  try {
    const opening = openAuthorizedPage({ child: browser.child, authorizeUrl })
    const outcome = opening.catch((error: unknown) => error)
    await browser.waitForRegistry()
    browser.child.emit("exit", 0, null)
    await expect(outcome).resolves.toBeInstanceOf(BrowserProcessExitedError)
    expect(browser.navigatedUrls()).toEqual(["chrome://extensions/"])
  } finally {
    browser.close()
  }
})

it("管道先关闭、浏览器随后退出时仍按浏览器退出处理", async () => {
  const browser = new SyntheticBrowser()
  try {
    const opening = openAuthorizedPage({ child: browser.child, authorizeUrl })
    const outcome = opening.catch((error: unknown) => error)
    await browser.waitForRegistry()
    const ended = once(browser.output, "end")
    browser.output.end()
    await ended
    browser.child.emit("exit", 0, null)
    await expect(outcome).resolves.toBeInstanceOf(BrowserProcessExitedError)
  } finally {
    browser.close()
  }
})

it("扩展目录仍在读取时浏览器退出会立即结束启动", async () => {
  const browser = new SyntheticBrowser()
  const pending = new Promise<string[]>(() => undefined)
  const readPaths = vi.spyOn(extensionPaths, "expectedExtensionPaths").mockReturnValueOnce(pending)
  try {
    const opening = openAuthorizedPage({ child: browser.child, authorizeUrl })
    const outcome = opening.catch((error: unknown) => error)
    expect(readPaths).toHaveBeenCalledOnce()
    browser.child.emit("exit", 0, null)
    await expect(outcome).resolves.toBeInstanceOf(BrowserProcessExitedError)
  } finally {
    readPaths.mockRestore()
    browser.close()
  }
})

type Request = {
  id: number
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

class SyntheticBrowser {
  readonly input = new PassThrough()
  readonly output = new PassThrough()
  readonly child = Object.assign(new EventEmitter(), {
    stdio: [null, null, null, this.input, this.output],
  }) as unknown as ChildProcess
  readonly #requests: Request[] = []
  readonly #registryPromise: Promise<void>
  #notifyRegistry: () => void = () => undefined
  #registryRequest: Request | undefined
  #buffer = ""
  #created = 0

  constructor() {
    this.#registryPromise = new Promise((resolve) => {
      this.#notifyRegistry = resolve
    })
    this.input.on("data", (chunk: Buffer) => {
      this.#buffer += chunk.toString("utf8")
      let end = this.#buffer.indexOf("\0")
      while (end !== -1) {
        const request = JSON.parse(this.#buffer.slice(0, end)) as Request
        this.#buffer = this.#buffer.slice(end + 1)
        this.#requests.push(request)
        this.#answer(request)
        end = this.#buffer.indexOf("\0")
      }
    })
  }

  waitForRegistry(): Promise<void> {
    return this.#registryPromise
  }

  confirmRegistry(): void {
    if (this.#registryRequest === undefined) throw new Error("缺少合成扩展状态请求")
    this.#reply(this.#registryRequest, { result: { type: "boolean", value: true } })
  }

  rejectRegistry(): void {
    if (this.#registryRequest === undefined) throw new Error("缺少合成扩展状态请求")
    this.#reply(this.#registryRequest, { exceptionDetails: {}, result: {} })
  }

  navigatedUrls(): unknown[] {
    return this.#requests
      .filter((request) => request.method === "Page.navigate")
      .map((request) => request.params["url"])
  }

  closedControlBeforeAuthorization(): boolean {
    const close = this.#requests.findIndex((request) => request.method === "Target.closeTarget")
    const authorize = this.#requests.findIndex(
      (request) => request.method === "Page.navigate" && request.params["url"] === authorizeUrl,
    )
    return close >= 0 && authorize > close
  }

  close(): void {
    this.input.destroy()
    this.output.destroy()
  }

  #answer(request: Request): void {
    if (request.method === "Runtime.evaluate") {
      this.#registryRequest = request
      this.#notifyRegistry()
      return
    }
    if (request.method === "Target.createTarget") {
      this.#created += 1
      this.#reply(request, { targetId: this.#created === 1 ? "login" : "control" })
      return
    }
    if (request.method === "Target.attachToTarget") {
      this.#reply(request, { sessionId: `${String(request.params["targetId"])}-session` })
      return
    }
    if (request.method === "Page.navigate" && request.params["url"] === "chrome://extensions/") {
      this.#event("Page.frameNavigated", request.sessionId, {
        frame: { url: "chrome://extensions/" },
      })
      this.#event("Page.domContentEventFired", request.sessionId, {})
    }
    this.#reply(request, request.method === "Target.closeTarget" ? { success: true } : {})
  }

  #reply(request: Request, result: Record<string, unknown>): void {
    this.output.write(`${JSON.stringify({ id: request.id, result })}\0`)
  }

  #event(method: string, sessionId: string | undefined, params: Record<string, unknown>): void {
    this.output.write(`${JSON.stringify({ method, sessionId, params })}\0`)
  }
}
