// 通过受信主窗口 IPC 验证关窗的各平台默认值、持久化和参数边界。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import { expect, it } from "vitest"
import { registerWindowClosePreference, WindowClosePreference } from "./window-close-preference"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

it.each([
  ["darwin", true],
  ["win32", true],
  ["linux", false],
] as const)("在 %s 使用默认行为并保存受信窗口修改", async (platform, initial) => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-window-pref-test-"))
  try {
    const path = join(root, "window-preferences.json")
    const preference = new WindowClosePreference(path, platform)
    const handlers = new Map<string, Handler>()
    const primary = {} as IpcMainInvokeEvent
    const stranger = {} as IpcMainInvokeEvent
    registerWindowClosePreference(
      { handle: (name, handler) => void handlers.set(name, handler) },
      (event) => event === primary,
      preference,
    )
    const get = handlers.get("pigclaude:window-close-to-tray-get")
    const set = handlers.get("pigclaude:window-close-to-tray-set")
    expect(await get?.(primary)).toBe(initial)
    expect(() => get?.(stranger)).toThrow("UNTRUSTED_WINDOW_REQUEST")
    await expect(set?.(stranger, !initial)).rejects.toThrow("UNTRUSTED_WINDOW_REQUEST")
    await expect(set?.(primary, "false")).rejects.toThrow("WINDOW_PREFERENCE_INVALID")
    expect(preference.current()).toBe(initial)
    expect(await set?.(primary, !initial)).toBe(!initial)
    expect(preference.current()).toBe(!initial)
    expect(await new WindowClosePreference(path, platform).get()).toBe(!initial)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
