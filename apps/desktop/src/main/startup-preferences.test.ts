// 验证登录启动只在托盘停留，唤回窗口后采用本机保存的 Dock 偏好。

import { EventEmitter } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { StartupPreferences } from "./startup-preferences"

it("首次登录启动隐藏窗口和 Dock，手动唤回后恢复偏好并能保存", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-startup-test-"))
  try {
    const login = {
      enabled: async () => false,
      set: vi.fn(async (enabled: boolean) => enabled),
      openedAutomatically: () => true,
    }
    const dock = { filePath: join(directory, "startup-preferences.json"), apply: vi.fn() }
    const preferences = new StartupPreferences(login, dock)
    const events = new EventEmitter()
    const window = { once: events.once.bind(events), show: vi.fn(() => events.emit("show")) }

    await preferences.prepare([])
    expect(preferences.attachWindow(window)).toBe(false)
    expect(dock.apply).toHaveBeenCalledExactlyOnceWith(false)
    expect(login.set).not.toHaveBeenCalled()
    await expect(preferences.get()).resolves.toEqual({ openAtLogin: false, showInDock: true })

    preferences.reopenFromSecondInstance(["--pigclaude-autostart"], window.show)
    expect(window.show).not.toHaveBeenCalled()
    preferences.reopenFromSecondInstance([], window.show)
    expect(window.show).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(dock.apply).toHaveBeenLastCalledWith(true))

    await expect(preferences.set("showInDock", false)).resolves.toBe(false)
    const restarted = new StartupPreferences({ ...login, openedAutomatically: () => false }, dock)
    await restarted.prepare([])
    await expect(restarted.get()).resolves.toMatchObject({ showInDock: false })
    expect(dock.apply).toHaveBeenLastCalledWith(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
