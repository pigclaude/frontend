// 负责用真实组件、hook 和供应商边界回调验证门禁、主题及过期实例隔离。
// @vitest-environment jsdom
import { createElement, StrictMode, useState } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CaptchaAction, CaptchaConfig } from "@pigclaude/contracts/captcha"
import { TurnstileCaptcha } from "./turnstile-captcha"
import { useTurnstileCaptcha } from "../hooks/use-turnstile-captcha"
import type { TurnstileOptions } from "../lib/turnstile-sdk"

const config: CaptchaConfig = {
  enabled: true,
  provider: "turnstile",
  siteKey: "test-key",
  mode: "testing",
}
const widgets: { id: string; options: TurnstileOptions; removed: boolean }[] = []
const results: (string | undefined)[] = []
let width = 400
let loadConfig = vi.fn<() => Promise<CaptchaConfig>>()

function installSdk() {
  Object.assign(window, {
    turnstile: {
      render: (_container: HTMLElement, options: TurnstileOptions) => {
        const id = `widget-${widgets.length}`
        widgets.push({ id, options, removed: false })
        return id
      },
      remove: (id: string) => {
        const widget = widgets.find((value) => value.id === id)
        if (widget) widget.removed = true
      },
    },
  })
}

function Harness({ action = "home_login" }: { action?: CaptchaAction }) {
  const gate = useTurnstileCaptcha({ loadConfig, action })
  const [submitted, setSubmitted] = useState(false)
  return createElement(
    "form",
    {
      onSubmit: (event) => {
        event.preventDefault()
        if (!gate.ready) return
        void gate.run(async (token) => {
          results.push(token)
          setSubmitted(true)
        })
      },
    },
    createElement(TurnstileCaptcha, gate.field),
    createElement("button", { type: "button", onClick: gate.retry }, "重新读取配置"),
    createElement("button", { type: "submit", disabled: !gate.ready }, "提交"),
    submitted ? createElement("p", null, "已提交") : null,
  )
}

function latest() {
  return widgets[widgets.length - 1]
}
function blocked() {
  return (screen.getByRole("button", { name: "提交" }) as HTMLButtonElement).disabled
}

beforeEach(() => {
  widgets.length = 0
  results.length = 0
  width = 400
  loadConfig = vi.fn<() => Promise<CaptchaConfig>>().mockResolvedValue(config)
  delete document.documentElement.dataset.theme
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, width, 80),
  )
  installSdk()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, "turnstile")
  delete document.documentElement.dataset.theme
  document.querySelectorAll("script[data-pigclaude-turnstile]").forEach((value) => value.remove())
})

describe("Turnstile challenge lifecycle", () => {
  it("requests interaction-only display without accepting a proof before the SDK callback", async () => {
    render(createElement(Harness))
    await waitFor(() => expect(widgets).toHaveLength(1))
    expect(latest().options).toMatchObject({ appearance: "interaction-only" })
    expect(blocked()).toBe(true)
    fireEvent.submit(document.querySelector("form") as HTMLFormElement)
    expect(results).toEqual([])
    act(() => latest().options.callback("verified-token"))
    expect(blocked()).toBe(false)
  })

  it("shows completion only for the active proof and replaces it after expiry and retry", async () => {
    render(createElement(Harness))
    await waitFor(() => expect(widgets).toHaveLength(1))
    expect(screen.queryByText("验证已完成")).toBeNull()
    const old = latest()
    act(() => old.options.callback(""))
    expect(screen.queryByText("验证已完成")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() => expect(widgets).toHaveLength(2))
    const active = latest()
    act(() => active.options.callback("fresh-token"))
    expect(screen.getByRole("status").textContent).toContain("验证已完成")
    act(() => active.options["expired-callback"]())
    expect(screen.queryByText("验证已完成")).toBeNull()
    expect(screen.getByRole("alert").textContent).toContain("验证码已过期")
    expect(blocked()).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() => expect(widgets).toHaveLength(3))
    act(() => active.options.callback("late-token"))
    expect(screen.queryByText("验证已完成")).toBeNull()
    expect(blocked()).toBe(true)
    act(() => latest().options.callback("new-token"))
    expect(screen.getByRole("status").textContent).toContain("验证已完成")
  })

  it("contains a synchronously failing config reader and keeps the form retryable", async () => {
    loadConfig.mockImplementationOnce(() => {
      throw new Error("reader unavailable")
    })
    render(createElement(Harness))
    expect((await screen.findByRole("alert")).textContent).toContain("验证码配置暂时无法加载")
    expect(blocked()).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() => expect(widgets).toHaveLength(1))
  })

  it("rejects an incomplete config and discards the previous widget when the mode changes", async () => {
    loadConfig.mockResolvedValueOnce({
      enabled: true,
      provider: "turnstile",
      siteKey: null,
      mode: "disabled",
    } as unknown as CaptchaConfig)
    render(createElement(Harness))
    expect((await screen.findByRole("alert")).textContent).toContain("验证码配置暂时无法加载")
    expect(blocked()).toBe(true)
    expect(widgets).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() => expect(widgets).toHaveLength(1))
    act(() => latest().options.callback("testing-token"))
    const old = latest()
    loadConfig.mockResolvedValueOnce({
      enabled: true,
      provider: "turnstile",
      siteKey: "required-key",
      mode: "required",
    })
    fireEvent.click(screen.getByRole("button", { name: "重新读取配置" }))
    await waitFor(() => expect(widgets).toHaveLength(2))
    expect(latest().options.sitekey).toBe("required-key")
    expect(old.removed).toBe(true)
    act(() => old.options.callback("late-testing-token"))
    expect(blocked()).toBe(true)
  })

  it("blocks invalid configuration and retries through the injected loader", async () => {
    loadConfig.mockRejectedValueOnce(new Error("offline"))
    render(createElement(Harness))
    expect(blocked()).toBe(true)
    expect((await screen.findByRole("alert")).textContent).toContain("验证码配置暂时无法加载")
    fireEvent.submit(document.querySelector("form") as HTMLFormElement)
    expect(results).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() => expect(widgets).toHaveLength(1))
    act(() => latest().options.callback("fresh-token"))
    expect(blocked()).toBe(false)
  })

  it("only the explicit disabled response permits a request without a token", async () => {
    loadConfig.mockResolvedValue({
      enabled: false,
      provider: "turnstile",
      siteKey: null,
      mode: "disabled",
    })
    render(createElement(Harness))
    await waitFor(() => expect(blocked()).toBe(false))
    fireEvent.submit(document.querySelector("form") as HTMLFormElement)
    await waitFor(() => expect(screen.getByText("已提交")).toBeTruthy())
    expect(results).toEqual([undefined])
    expect(widgets).toHaveLength(0)
  })

  it("blocks a failed SDK and retries by loading a new script", async () => {
    Reflect.deleteProperty(window, "turnstile")
    render(createElement(Harness))
    await waitFor(() =>
      expect(document.querySelector("script[data-pigclaude-turnstile]")).toBeTruthy(),
    )
    act(() =>
      document.querySelector("script[data-pigclaude-turnstile]")?.dispatchEvent(new Event("error")),
    )
    expect((await screen.findByRole("alert")).textContent).toContain("验证码组件加载失败")
    expect(blocked()).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() =>
      expect(document.querySelector("script[data-pigclaude-turnstile]")).toBeTruthy(),
    )
    installSdk()
    act(() =>
      document.querySelector("script[data-pigclaude-turnstile]")?.dispatchEvent(new Event("load")),
    )
    await waitFor(() => expect(widgets).toHaveLength(1))
    act(() => latest().options.callback("fresh-token"))
    expect(blocked()).toBe(false)
  })

  it.each([
    "expired-callback",
    "error-callback",
    "timeout-callback",
    "unsupported-callback",
  ] as const)(
    "invalidates on %s and ignores late success until retry creates a fresh widget",
    async (callback) => {
      render(createElement(Harness))
      await waitFor(() => expect(widgets).toHaveLength(1))
      const old = latest()
      act(() => old.options.callback("old-token"))
      expect(blocked()).toBe(false)
      act(() => old.options[callback]())
      expect(blocked()).toBe(true)
      act(() => old.options.callback("late-token"))
      expect(blocked()).toBe(true)
      fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
      await waitFor(() => expect(widgets).toHaveLength(2))
      expect(old.removed).toBe(true)
      act(() => latest().options.callback("fresh-token"))
      expect(blocked()).toBe(false)
    },
  )

  it("recreates the widget for theme and narrow layout, invalidating its old token", async () => {
    render(createElement(Harness))
    await waitFor(() => expect(widgets).toHaveLength(1))
    const dark = latest()
    expect(dark.options).toMatchObject({
      theme: "dark",
      size: "flexible",
      language: "zh-cn",
      "response-field": false,
      "refresh-timeout": "never",
    })
    act(() => dark.options.callback("dark-token"))
    act(() => {
      document.documentElement.dataset.theme = "light"
    })
    await waitFor(() => expect(latest().options.theme).toBe("light"))
    expect(dark.removed).toBe(true)
    act(() => dark.options.callback("stale-dark-token"))
    expect(blocked()).toBe(true)
    const light = latest()
    act(() => light.options.callback("light-token"))
    width = 260
    fireEvent(window, new Event("resize"))
    await waitFor(() => expect(latest().options.size).toBe("compact"))
    expect(light.removed).toBe(true)
    expect(blocked()).toBe(true)
    act(() => latest().options.callback("compact-token"))
    fireEvent.submit(document.querySelector("form") as HTMLFormElement)
    await waitFor(() => expect(results).toEqual(["compact-token"]))
  })

  it("isolates action switches and ignores callbacks from unmounted instances in StrictMode", async () => {
    const view = render(createElement(StrictMode, null, createElement(Harness)))
    await waitFor(() => expect(widgets.filter((widget) => !widget.removed)).toHaveLength(1))
    const login = latest()
    act(() => login.options.callback("login-token"))
    view.rerender(
      createElement(StrictMode, null, createElement(Harness, { action: "home_register" })),
    )
    await waitFor(() => expect(latest().options.action).toBe("home_register"))
    expect(login.removed).toBe(true)
    act(() => login.options.callback("late-login-token"))
    expect(blocked()).toBe(true)
    const registration = latest()
    view.unmount()
    expect(registration.removed).toBe(true)
    act(() => registration.options.callback("unmounted-token"))
    expect(results).toEqual([])
  })
})
