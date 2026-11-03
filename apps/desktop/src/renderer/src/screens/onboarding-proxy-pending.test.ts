// 验证新手引导在代理核对期间不能重复提交或离开，并在核对结束后继续。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { OnboardingScreen } from "./onboarding-screen"

it("验证期间禁用重复提交、跳过与稍后再说", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let finish: () => void = () => undefined
  const onAddProxy = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  try {
    await act(async () =>
      root.render(
        createElement(OnboardingScreen, {
          onAddProxy,
          onFinish: () => undefined,
          onOpenAuthorize: () => undefined,
        }),
      ),
    )
    const input = container.querySelector<HTMLInputElement>('input[aria-label="代理地址"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "http://proxy.test:8000",
      )
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const form = container.querySelector("form")
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    expect(onAddProxy).toHaveBeenCalledTimes(1)
    const buttons = [...container.querySelectorAll("button")]
    expect(buttons.find((button) => button.textContent?.includes("正在验证"))?.disabled).toBe(true)
    expect(buttons.find((button) => button.textContent === "跳过")?.disabled).toBe(true)
    expect(buttons.find((button) => button.textContent === "稍后再说")?.disabled).toBe(true)
    await act(async () => finish())
    expect(container.textContent).toContain("添加 Claude 账号")
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
