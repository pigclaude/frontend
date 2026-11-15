// 验证应用上下文把插件通知作为标注来源的短提示展示，重渲染不重复订阅。
// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import type {
  CapabilityPluginNotice,
  CapabilityPluginNoticesBridge,
} from "../../capability-plugin-notice-contract"
import { AppProviders } from "./app-providers"

it("以纯文本展示插件名和消息，并在应用上下文卸载时解除订阅", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers()
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  let deliver: ((notice: CapabilityPluginNotice) => void) | undefined
  const unsubscribe = vi.fn(() => {
    deliver = undefined
  })
  const subscribe = vi.fn<CapabilityPluginNoticesBridge["subscribe"]>((listener) => {
    deliver = listener
    return unsubscribe
  })
  window.pigclaude = { platform: "darwin", capabilityPluginNotices: { subscribe } }
  try {
    await act(async () => root.render(createElement(AppProviders, { children: "会话" })))
    await act(async () => root.render(createElement(AppProviders, { children: "设置" })))
    expect(subscribe).toHaveBeenCalledTimes(1)

    await act(async () => deliver?.({ pluginName: "摘录", message: "<strong>合成摘要</strong>" }))
    const stack = host.querySelector('[role="status"]')
    expect(stack?.textContent).toBe("插件「摘录」 · <strong>合成摘要</strong>")
    expect(stack?.querySelector("strong")).toBeNull()

    await act(async () => vi.advanceTimersByTime(2_400))
    expect(stack?.textContent).toBe("")
  } finally {
    await act(async () => root.unmount())
    host.remove()
    delete window.pigclaude
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})
