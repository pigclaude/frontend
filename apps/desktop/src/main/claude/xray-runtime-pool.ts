// 按代理配置复用 Xray，并在没有使用者时延迟回收。

import { createHash } from "node:crypto"
import type { ProxyRuntime, StartProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import { ClaudeAccountError } from "./errors"
import { XrayStartupCleanupError } from "./xray-runtime-errors"

type Entry = {
  refs: number
  startup: Promise<XrayCoreRuntime>
  current?: XrayCoreRuntime | undefined
  timer?: ReturnType<typeof setTimeout> | undefined
  listeners: Set<(error: Error) => void>
}

/** 单个 Xray 进程退出时可通知管理器的运行实例。 */
export type XrayCoreRuntime = ProxyRuntime & { exited: Promise<void> }

/** 启动指定上游，可指定恢复时使用的原端口。 */
export type StartXrayCore = (input: {
  upstreamProxyUrl: string
  port?: number
}) => Promise<XrayCoreRuntime>

/** 按 Ant Browser 的引用计数方式共享和回收 Xray 入口。 */
export function createXrayRuntimePool(
  startCore: StartXrayCore,
  idleTimeoutMs: number,
): StartProxyRuntime & { dispose: () => Promise<void> } {
  const entries = new Map<string, Entry>()
  const retiring = new Set<Promise<void>>()
  const retiringByKey = new Map<string, Promise<void>>()
  const failed = new Map<Entry, string>()
  const failedStarts = new Map<string, XrayStartupCleanupError>()
  const cleanedStarts = new WeakSet<XrayStartupCleanupError>()
  let disposed = false

  const watch = (key: string, entry: Entry, core: XrayCoreRuntime, upstreamProxyUrl: string) => {
    void core.exited.then(
      async () => {
        if (disposed || entries.get(key) !== entry || entry.current !== core) return
        entry.current = undefined
        if (entry.refs === 0) {
          if (entry.timer !== undefined) clearTimeout(entry.timer)
          entries.delete(key)
          return
        }
        const port = Number(new URL(core.url).port)
        const restarting = startCore({ upstreamProxyUrl, port })
        entry.startup = restarting
        try {
          const restored = await restarting
          if (restored.url !== core.url) {
            await restored.close()
            throw unavailable()
          }
          entry.current = restored
          watch(key, entry, restored, upstreamProxyUrl)
        } catch (error: unknown) {
          if (error instanceof XrayStartupCleanupError && !cleanedStarts.has(error)) {
            failedStarts.set(key, error)
          }
          if (entries.get(key) === entry) {
            if (entry.timer !== undefined) clearTimeout(entry.timer)
            entries.delete(key)
            for (const notify of entry.listeners) notify(unavailable())
          }
        }
      },
      () => {
        if (disposed || entries.get(key) !== entry || entry.current !== core) return
        if (entry.timer !== undefined) clearTimeout(entry.timer)
        entries.delete(key)
        entry.current = undefined
        failed.set(entry, key)
        for (const notify of entry.listeners) notify(unavailable())
      },
    )
  }

  const retire = (key: string, entry: Entry): Promise<void> => {
    const existing = retiringByKey.get(key)
    if (existing !== undefined) return existing
    if (entries.get(key) === entry) entries.delete(key)
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    const task = entry.startup.then(
      (runtime) => runtime.close(),
      async (error: unknown) => {
        if (!(error instanceof XrayStartupCleanupError) || cleanedStarts.has(error)) return
        failedStarts.set(key, error)
        await error.cleanup()
        cleanedStarts.add(error)
        if (failedStarts.get(key) === error) failedStarts.delete(key)
      },
    )
    retiring.add(task)
    retiringByKey.set(key, task)
    void task.then(
      () => {
        retiring.delete(task)
        if (retiringByKey.get(key) === task) retiringByKey.delete(key)
        failed.delete(entry)
      },
      () => {
        retiring.delete(task)
        if (retiringByKey.get(key) === task) retiringByKey.delete(key)
        failed.set(entry, key)
      },
    )
    return task
  }

  const retryFailedStart = async (key: string): Promise<void> => {
    const failure = failedStarts.get(key)
    if (failure === undefined) return
    let cleanup = retiringByKey.get(key)
    if (cleanup === undefined) {
      cleanup = Promise.resolve().then(() => failure.cleanup())
      retiringByKey.set(key, cleanup)
      const current = cleanup
      void cleanup.then(
        () => {
          cleanedStarts.add(failure)
          if (failedStarts.get(key) === failure) failedStarts.delete(key)
          if (retiringByKey.get(key) === current) retiringByKey.delete(key)
        },
        () => {
          if (retiringByKey.get(key) === current) retiringByKey.delete(key)
        },
      )
    }
    await cleanup
  }

  const acquire: StartProxyRuntime = async (input) => {
    if (disposed) throw unavailable()
    let canonical: string
    try {
      const url = new URL(input.upstreamProxyUrl)
      if (url.protocol !== "http:" && url.protocol !== "https:") throw unavailable()
      canonical = url.href
    } catch {
      throw unavailable()
    }
    const key = createHash("sha256").update(canonical).digest("hex")
    const closing = retiringByKey.get(key)
    try {
      if (closing !== undefined) await closing
    } catch {
      throw unavailable()
    }
    if (disposed) throw unavailable()
    try {
      await retryFailedStart(key)
    } catch {
      throw unavailable()
    }
    const pending = [...failed.entries()].find(([, failedKey]) => failedKey === key)
    if (pending !== undefined) {
      try {
        await retire(key, pending[0])
      } catch {
        throw unavailable()
      }
    }
    if (disposed) throw unavailable()
    let entry = entries.get(key)
    if (entry === undefined) {
      entry = {
        refs: 0,
        startup: Promise.resolve().then(() => startCore(input)),
        listeners: new Set(),
      }
      entries.set(key, entry)
      const created = entry
      void created.startup.then(
        (core) => {
          created.current = core
          watch(key, created, core, input.upstreamProxyUrl)
        },
        () => undefined,
      )
    }
    const selected = entry
    if (selected.timer !== undefined) {
      clearTimeout(selected.timer)
      selected.timer = undefined
    }
    selected.refs += 1
    let core: XrayCoreRuntime
    try {
      core = await selected.startup
      core.assertRunning?.()
      if (disposed) throw unavailable()
    } catch (error: unknown) {
      if (error instanceof XrayStartupCleanupError) failedStarts.set(key, error)
      selected.refs -= 1
      if (selected.refs === 0 && entries.get(key) === selected) entries.delete(key)
      throw error
    }
    let released = false
    let releaseTask: Promise<void> | undefined
    let notify: (error: Error) => void = () => undefined
    const failure = new Promise<Error>((resolve) => {
      notify = resolve
    })
    selected.listeners.add(notify)
    return {
      url: core.url,
      failure,
      assertRunning: () => {
        if (released || disposed) throw unavailable()
        const current = selected.current
        if (current === undefined) throw unavailable()
        current.assertRunning?.()
      },
      ready: async () => {
        while (!released && !disposed) {
          const startup = selected.startup
          const current = await startup
          try {
            current.assertRunning?.()
            return
          } catch (error: unknown) {
            await current.exited
            if (selected.startup === startup) throw error
          }
        }
        throw unavailable()
      },
      close: () => {
        if (releaseTask !== undefined) return releaseTask
        if (!released) {
          released = true
          selected.listeners.delete(notify)
          selected.refs -= 1
          if (selected.refs !== 0) return Promise.resolve()
          const active = entries.get(key) === selected
          if (!active && !failed.has(selected) && !failedStarts.has(key)) return Promise.resolve()
          if (active && idleTimeoutMs > 0) {
            selected.timer = setTimeout(() => {
              void retire(key, selected).catch(() => console.error("XRAY_IDLE_CLEANUP_FAILED"))
            }, idleTimeoutMs)
            selected.timer.unref?.()
            return Promise.resolve()
          }
        } else if (!failed.has(selected) && !failedStarts.has(key)) {
          return Promise.resolve()
        }
        const task = retire(key, selected)
        releaseTask = task
        void task.catch(() => {
          if (releaseTask === task) releaseTask = undefined
        })
        return task
      },
    }
  }

  return Object.assign(acquire, {
    dispose: async () => {
      disposed = true
      const retry = new Map<Entry, string>(
        [...entries.entries()].map(([key, entry]) => [entry, key]),
      )
      for (const [entry, key] of failed) retry.set(entry, key)
      const tasks = [...retry].map(([entry, key]) => retire(key, entry))
      const starts = [...failedStarts.keys()].map((key) => retryFailedStart(key))
      const results = await Promise.allSettled([...tasks, ...retiring, ...starts])
      if (results.some((result) => result.status === "rejected")) {
        throw unavailable()
      }
    },
  })
}

function unavailable(): ClaudeAccountError {
  return new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 代理不可用，请勿登录")
}
