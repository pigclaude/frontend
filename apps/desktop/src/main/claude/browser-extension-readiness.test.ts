// 验证浏览器先观察指定扩展状态，再允许首次授权页面打开。

import { runInNewContext } from "node:vm"
import { expect, it, vi } from "vitest"
import { extensionReadinessExpression } from "./browser-extension-readiness"

it("指定扩展未出现时保持等待，启用事件到达后确认就绪", async () => {
  const listeners = new Set<() => void>()
  let extensions: Array<{ path: string; state: string }> = []
  const context = {
    chrome: {
      developerPrivate: {
        getExtensionsInfo: vi.fn(async () => extensions),
        onItemStateChanged: {
          addListener: (listener: () => void) => listeners.add(listener),
          removeListener: (listener: () => void) => listeners.delete(listener),
        },
      },
    },
  }
  const ready = runInNewContext(
    extensionReadinessExpression(["/synthetic/extension"], "linux"),
    context,
  ) as Promise<boolean>
  let settled = false
  void ready.then(() => {
    settled = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
  extensions = [{ path: "/synthetic/extension", state: "ENABLED" }]
  for (const listener of listeners) listener()
  await expect(ready).resolves.toBe(true)
  expect(listeners.size).toBe(0)
})

it("禁用的扩展不满足就绪条件，Windows 路径比较不区分大小写", async () => {
  const listeners = new Set<() => void>()
  let state = "DISABLED"
  const context = {
    chrome: {
      developerPrivate: {
        getExtensionsInfo: async () => [{ path: "C:\\SYNTHETIC\\Extension", state }],
        onItemStateChanged: {
          addListener: (listener: () => void) => listeners.add(listener),
          removeListener: (listener: () => void) => listeners.delete(listener),
        },
      },
    },
  }
  const ready = runInNewContext(
    extensionReadinessExpression(["c:\\synthetic\\extension"], "win32"),
    context,
  ) as Promise<boolean>
  let settled = false
  void ready.then(() => {
    settled = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
  state = "ENABLED"
  for (const listener of listeners) listener()
  await expect(ready).resolves.toBe(true)
})

it("扩展变化发生在首次列表读取期间时仍会再次核对", async () => {
  const listeners = new Set<() => void>()
  let release: (value: Array<{ path: string; state: string }>) => void = () => undefined
  const first = new Promise<Array<{ path: string; state: string }>>((resolve) => {
    release = resolve
  })
  const getExtensionsInfo = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce([{ path: "/synthetic/extension", state: "ENABLED" }])
  const ready = runInNewContext(extensionReadinessExpression(["/synthetic/extension"], "linux"), {
    chrome: {
      developerPrivate: {
        getExtensionsInfo,
        onItemStateChanged: {
          addListener: (listener: () => void) => listeners.add(listener),
          removeListener: (listener: () => void) => listeners.delete(listener),
        },
      },
    },
  }) as Promise<boolean>
  for (const listener of listeners) listener()
  release([])
  await expect(ready).resolves.toBe(true)
  expect(getExtensionsInfo).toHaveBeenCalledTimes(2)
})

it("POSIX 扩展目录中的反斜杠不会被当成路径分隔符", async () => {
  const listeners = new Set<() => void>()
  let path = "/synthetic/a/b"
  const ready = runInNewContext(extensionReadinessExpression(["/synthetic/a\\b"], "darwin"), {
    chrome: {
      developerPrivate: {
        getExtensionsInfo: async () => [{ path, state: "ENABLED" }],
        onItemStateChanged: {
          addListener: (listener: () => void) => listeners.add(listener),
          removeListener: (listener: () => void) => listeners.delete(listener),
        },
      },
    },
  }) as Promise<boolean>
  let settled = false
  void ready.then(() => {
    settled = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
  path = "/synthetic/a\\b"
  for (const listener of listeners) listener()
  await expect(ready).resolves.toBe(true)
})

it("Windows 的 UNC 长路径与普通 UNC 路径按同一目录比较", async () => {
  const listeners = new Set<() => void>()
  const ready = runInNewContext(
    extensionReadinessExpression(["\\\\server\\share\\extension"], "win32"),
    {
      chrome: {
        developerPrivate: {
          getExtensionsInfo: async () => [
            { path: "\\\\?\\UNC\\SERVER\\SHARE\\extension", state: "ENABLED" },
          ],
          onItemStateChanged: {
            addListener: (listener: () => void) => listeners.add(listener),
            removeListener: (listener: () => void) => listeners.delete(listener),
          },
        },
      },
    },
  ) as Promise<boolean>
  await expect(ready).resolves.toBe(true)
  expect(listeners.size).toBe(0)
})

it("扩展状态接口出错时失败并移除事件监听", async () => {
  const listeners = new Set<() => void>()
  const ready = runInNewContext(extensionReadinessExpression([], "linux"), {
    chrome: {
      developerPrivate: {
        getExtensionsInfo: async () => {
          throw new Error("synthetic failure")
        },
        onItemStateChanged: {
          addListener: (listener: () => void) => listeners.add(listener),
          removeListener: (listener: () => void) => listeners.delete(listener),
        },
      },
    },
  }) as Promise<boolean>
  await expect(ready).rejects.toThrow("synthetic failure")
  expect(listeners.size).toBe(0)
})
