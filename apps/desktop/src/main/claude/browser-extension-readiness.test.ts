// 验证扩展状态变化与目录核对之间不会漏掉事件或提前放行。

import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createContext, runInContext } from "node:vm"
import { expect, it } from "vitest"
import type { BrowserControlPipe } from "./browser-control-pipe"
import { createExtensionReadiness } from "./browser-extension-readiness"

it("指定扩展尚未启用时等待状态事件，启用后继续", async () => {
  const directory = await mkdtemp(join(tmpdir(), "extension-readiness-"))
  const registry = new SyntheticRegistry()
  try {
    const check = await createExtensionReadiness({
      pipe: registry.pipe,
      sessionId: "synthetic",
      paths: [await realpath(directory)],
      platform: process.platform,
    })
    const waiting = check()
    let settled = false
    void waiting.then(() => {
      settled = true
    })
    await registry.firstSnapshot
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    registry.update([{ path: directory, state: "ENABLED", location: "UNPACKED" }])
    await expect(waiting).resolves.toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("状态事件发生在列表读取期间时仍会重新核对", async () => {
  const directory = await mkdtemp(join(tmpdir(), "extension-readiness-"))
  const registry = new SyntheticRegistry()
  let release: (value: Extension[]) => void = () => undefined
  registry.firstRead = new Promise<Extension[]>((resolve) => {
    release = resolve
  })
  try {
    const check = await createExtensionReadiness({
      pipe: registry.pipe,
      sessionId: "synthetic",
      paths: [await realpath(directory)],
      platform: process.platform,
    })
    const waiting = check()
    await registry.firstSnapshot
    registry.update([{ path: directory, state: "ENABLED", location: "UNPACKED" }])
    release([])
    await expect(waiting).resolves.toBeUndefined()
    expect(registry.reads).toBe(2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("目录核对期间扩展被禁用时，不使用旧快照放行", async () => {
  const directory = await mkdtemp(join(tmpdir(), "extension-readiness-"))
  const registry = new SyntheticRegistry()
  let release: () => void = () => undefined
  let notify: () => void = () => undefined
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = new Promise<void>((resolve) => {
    notify = resolve
  })
  let first = true
  const pipe = {
    request: registry.pipe.request.bind(registry.pipe),
    race: async <T>(task: Promise<T>) => {
      const result = await task
      if (first) {
        first = false
        notify()
        await blocked
      }
      return result
    },
  } as unknown as BrowserControlPipe
  try {
    registry.update([{ path: directory, state: "ENABLED", location: "UNPACKED" }])
    const check = await createExtensionReadiness({
      pipe,
      sessionId: "synthetic",
      paths: [await realpath(directory)],
      platform: process.platform,
    })
    const waiting = check()
    let settled = false
    void waiting.then(() => {
      settled = true
    })
    await entered
    registry.update([])
    release()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    registry.update([{ path: directory, state: "ENABLED", location: "UNPACKED" }])
    await expect(waiting).resolves.toBeUndefined()
  } finally {
    release()
    await rm(directory, { recursive: true, force: true })
  }
})

it("浏览器无法读取扩展列表时明确失败", async () => {
  const registry = new SyntheticRegistry()
  registry.fail = true
  const check = await createExtensionReadiness({
    pipe: registry.pipe,
    sessionId: "synthetic",
    paths: [],
    platform: process.platform,
  })
  await expect(check()).rejects.toThrow("无法确认浏览器扩展状态")
})

type Extension = { path: string; state: string; location: string }

class SyntheticRegistry {
  readonly #listeners = new Set<() => void>()
  readonly #context = createContext({
    chrome: {
      developerPrivate: {
        getExtensionsInfo: async () => {
          this.reads += 1
          this.#notifySnapshot()
          if (this.fail) throw new Error("synthetic registry failure")
          if (this.firstRead !== undefined) {
            const first = this.firstRead
            this.firstRead = undefined
            return first
          }
          return this.#extensions
        },
        onItemStateChanged: {
          addListener: (listener: () => void) => this.#listeners.add(listener),
        },
      },
    },
  })
  readonly firstSnapshot: Promise<void>
  readonly pipe: BrowserControlPipe
  #notifySnapshot: () => void = () => undefined
  #extensions: Extension[] = []
  firstRead: Promise<Extension[]> | undefined
  reads = 0
  fail = false

  constructor() {
    this.firstSnapshot = new Promise((resolve) => {
      this.#notifySnapshot = resolve
    })
    this.pipe = {
      request: async (_method: string, params: Record<string, unknown>) => {
        try {
          const value: unknown = await runInContext(String(params["expression"]), this.#context)
          return { result: { value } }
        } catch {
          return { result: {}, exceptionDetails: {} }
        }
      },
      race: <T>(task: Promise<T>) => task,
    } as unknown as BrowserControlPipe
  }

  update(extensions: Extension[]): void {
    this.#extensions = extensions
    for (const listener of this.#listeners) listener()
  }
}
