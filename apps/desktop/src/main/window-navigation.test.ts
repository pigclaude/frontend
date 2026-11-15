// 核对原生入口唤回窗口及导航晚于窗口加载时的交付，拒绝非主窗口取走导航。

import type { IpcMainInvokeEvent } from "electron"
import { expect, it, vi } from "vitest"
import {
  takeWindowNavigationChannel,
  windowNavigationAvailableChannel,
} from "../window-navigation-contract"
import { WindowNavigation } from "./window-navigation"

it("先唤回窗口，等受信渲染层就绪后只交付一次会话导航", () => {
  const order: string[] = []
  const navigation = new WindowNavigation(
    () => order.push("restore"),
    (channel) => order.push(channel),
  )
  const trusted = {} as IpcMainInvokeEvent
  const untrusted = {} as IpcMainInvokeEvent
  const ipc = { handle: vi.fn() }
  navigation.register(ipc, (event) => event === trusted)
  const [channel, take] = ipc.handle.mock.calls[0] ?? []
  expect(channel).toBe(takeWindowNavigationChannel)

  navigation.openSession("session-b")
  expect(order).toEqual(["restore", windowNavigationAvailableChannel])
  expect(() => take(untrusted)).toThrow("UNTRUSTED_WINDOW_REQUEST")
  expect(take(trusted)).toEqual({ kind: "session", sessionId: "session-b" })
  expect(take(trusted)).toBeNull()
})
