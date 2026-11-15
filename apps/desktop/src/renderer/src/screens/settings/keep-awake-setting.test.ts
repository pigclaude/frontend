// 验证「通用」内的唤醒开关读取本机状态，接受主进程确认后才改变显示。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { AppProviders } from "../../app-providers"
import { GeneralSettings } from "./settings-app-pages"

it("读取本机唤醒偏好并在保存成功后更新开关", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const get = vi.fn().mockResolvedValue(false)
  let acknowledge: ((enabled: boolean) => void) | undefined
  const set = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        acknowledge = resolve
      }),
  )
  window.pigclaude = { platform: "darwin", keepAwake: { get, set } }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        createElement(AppProviders, null, createElement(GeneralSettings, { appVersion: null })),
      ),
    )
    const toggle = container.querySelector<HTMLElement>(
      '[role="switch"][aria-label="保持电脑唤醒"]',
    )
    if (!toggle) throw new Error("没有找到本机唤醒开关")
    expect(get).toHaveBeenCalledOnce()
    expect(toggle.getAttribute("aria-checked")).toBe("false")

    await act(async () => toggle.click())
    expect(set).toHaveBeenCalledExactlyOnceWith(true)
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect(toggle.getAttribute("aria-disabled")).toBe("true")
    await act(async () => acknowledge?.(true))
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(toggle.getAttribute("aria-disabled")).not.toBe("true")
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete window.pigclaude
    vi.unstubAllGlobals()
  }
})
