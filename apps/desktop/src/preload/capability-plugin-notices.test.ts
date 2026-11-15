// 验证通知订阅只转发固定频道上的显示字段，并能解除侦听。

import { ipcRenderer } from "electron"
import { expect, it, vi } from "vitest"
import { capabilityPluginNoticeChannel } from "../capability-plugin-notice-contract"
import { capabilityPluginNoticesBridge } from "./capability-plugin-notices"

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  return { ipcRenderer: new EventEmitter() }
})

it("在固定频道订阅一次，仅调用渲染器的纯文本回调", () => {
  const listener = vi.fn()
  const bridge = capabilityPluginNoticesBridge()
  expect(Object.keys(bridge)).toEqual(["subscribe"])
  const unsubscribe = bridge.subscribe(listener)
  try {
    const event = { sender: "不传给渲染器的 IPC 字段" }
    const payload = { pluginName: " 文档摘要 ", message: "<b>就绪</b>", internal: "不跨边界" }
    ipcRenderer.emit("pigclaude:other", event, payload)
    ipcRenderer.emit(capabilityPluginNoticeChannel, event, { ...payload, message: 1 })
    expect(listener).not.toHaveBeenCalled()

    ipcRenderer.emit(capabilityPluginNoticeChannel, event, payload)
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      pluginName: "文档摘要",
      message: "<b>就绪</b>",
    })
  } finally {
    expect(unsubscribe()).toBeUndefined()
  }
  expect(ipcRenderer.listenerCount(capabilityPluginNoticeChannel)).toBe(0)
})
