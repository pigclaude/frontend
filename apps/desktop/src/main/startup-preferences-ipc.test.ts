// 验证通用设置 IPC 拒绝跨窗口和非法请求，并只返回用户可修改的设置。

import type { IpcMainInvokeEvent } from "electron"
import { expect, it, vi } from "vitest"
import type { StartupPreferencesBridge } from "../startup-preferences-contract"
import { registerStartupPreferencesIpc } from "./startup-preferences-ipc"

type Handler = (event: IpcMainInvokeEvent, ...values: unknown[]) => unknown

it("只允许可信窗口使用已知偏好名和布尔值，系统错误只返回固定错误码", async () => {
  const trusted = {} as IpcMainInvokeEvent
  const stranger = {} as IpcMainInvokeEvent
  const handlers = new Map<string, Handler>()
  const preferences = {
    get: vi.fn<StartupPreferencesBridge["get"]>().mockResolvedValue({
      openAtLogin: false,
      showInDock: null,
    }),
    set: vi.fn<StartupPreferencesBridge["set"]>().mockResolvedValue(true),
  }
  registerStartupPreferencesIpc(
    { handle: (channel, handler) => void handlers.set(channel, handler) },
    (event) => event === trusted,
    preferences,
  )
  const get = handlers.get("pigclaude:startup-preferences-get")!
  const set = handlers.get("pigclaude:startup-preferences-set")!

  expect(() => get(stranger)).toThrow("UNTRUSTED_STARTUP_PREFERENCE_REQUEST")
  expect(() => set(stranger, "openAtLogin", true)).toThrow("UNTRUSTED_STARTUP_PREFERENCE_REQUEST")
  expect(() => set(trusted, "executable", true)).toThrow("STARTUP_PREFERENCE_INVALID")
  expect(() => set(trusted, "openAtLogin", "true")).toThrow("STARTUP_PREFERENCE_INVALID")
  expect(preferences.get).not.toHaveBeenCalled()
  expect(preferences.set).not.toHaveBeenCalled()
  await expect(get(trusted)).resolves.toEqual({ openAtLogin: false, showInDock: null })
  await expect(set(trusted, "openAtLogin", true)).resolves.toBe(true)
  expect(preferences.set).toHaveBeenCalledExactlyOnceWith("openAtLogin", true)

  preferences.set.mockRejectedValueOnce(new Error("private system error"))
  await expect(set(trusted, "openAtLogin", false)).rejects.toThrow("STARTUP_PREFERENCE_SAVE_FAILED")
})
