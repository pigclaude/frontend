// 负责验证桌面登录页、等待浏览器页和确认会员页的文案、按钮与复制链接反馈。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createLoginState, reduceLoginState, type LoginState } from "../models/login-model"
import { LoginScreen, type LoginScreenProps } from "./login-screen"

const authorizationUrl = "http://127.0.0.1:8788/oauth2/authorize?state=secret-state&client=desk"

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function waiting(intent: "login" | "register"): LoginState {
  return reduceLoginState(createLoginState(), {
    type: "started",
    intent,
    sessionId: "session",
    authorizationUrl,
    expiresAt: 600_000,
  })
}

async function render(props: Partial<LoginScreenProps> & { state: LoginState }): Promise<void> {
  await act(async () =>
    root.render(
      createElement(LoginScreen, {
        onAuthorize: () => undefined,
        onCancel: () => undefined,
        onReset: () => undefined,
        ...props,
      }),
    ),
  )
}

function button(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
}

describe("desktop login screen", () => {
  it("shows the new idle copy without security disclaimers", async () => {
    const onAuthorize = vi.fn()
    await render({ state: createLoginState(), onAuthorize })
    const text = container.textContent ?? ""

    expect(text).toContain("欢迎使用 PigClaude")
    expect(text).toContain("登录后即可使用你的会员")
    expect(text).toContain("将在浏览器中打开 PigClaude 网站完成")
    expect(text).not.toContain("不会保存你的密码")
    expect(text).not.toContain("不会在这里输入凭据")
    expect(text).not.toContain("pigclaude")
    expect(container.querySelector("h1")?.textContent).toBe("欢迎使用 PigClaude")

    await act(async () => button("登录")?.click())
    await act(async () => button("注册")?.click())
    expect(onAuthorize.mock.calls).toEqual([["login"], ["register"]])
  })

  it("keeps the gate message, sign-out retry and withdraw above the two buttons", async () => {
    const onRetrySignOut = vi.fn()
    await render({
      state: createLoginState(),
      gateMessage: "退出登录失败：磁盘不可用",
      canWithdraw: true,
      onRetrySignOut,
    })
    const text = container.textContent ?? ""
    const login = button("登录")

    expect(text.indexOf("退出登录失败")).toBeLessThan(text.indexOf("将在浏览器中打开"))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("退出登录失败")
    expect(button("撤销本机授权")).toBeDefined()
    expect(login?.disabled).toBe(true)
    expect(button("注册")?.disabled).toBe(true)
    const order = [button("重试退出"), button("撤销本机授权"), login].map((element) =>
      [...container.querySelectorAll("button")].indexOf(element as HTMLButtonElement),
    )
    expect(order).toEqual([...order].sort((left, right) => left - right))
    await act(async () => button("重试退出")?.click())
    expect(onRetrySignOut).toHaveBeenCalledOnce()
  })

  it("hides the full authorization url while waiting", async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const onAuthorize = vi.fn()
    const onCancel = vi.fn()
    await render({ state: waiting("login"), onAuthorize, onCancel })
    const text = container.textContent ?? ""

    expect(text).toContain("请在浏览器中继续")
    expect(text).toContain("已为你打开 PigClaude 网站，登录并授权这台设备后会自动回到这里。")
    expect(text).not.toContain(authorizationUrl)
    expect(text).not.toContain("secret-state")
    expect(container.innerHTML).not.toContain("secret-state")

    await act(async () => button("复制链接")?.click())
    expect(writeText).toHaveBeenCalledWith(authorizationUrl)
    expect(button("已复制")).toBeDefined()

    await act(async () => button("重新打开浏览器")?.click())
    await act(async () => button("取消")?.click())
    expect(onAuthorize).toHaveBeenCalledWith("login")
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("uses the register sentence while waiting for a registration", async () => {
    await render({ state: waiting("register") })

    expect(container.textContent).toContain(
      "已为你打开 PigClaude 网站，注册并授权这台设备后会自动回到这里。",
    )
  })

  it("shows membership confirmation without a success page", async () => {
    const confirming = reduceLoginState(waiting("login"), {
      type: "completed",
      intent: "login",
      sessionId: "session",
      displayName: "林舟",
      expiresAt: 900_000,
    })
    await render({ state: confirming })
    const text = container.textContent ?? ""

    expect(text).toContain("正在确认会员…")
    expect(text).not.toContain("开始使用")
    expect(container.querySelector('[role="status"]')).not.toBeNull()
  })

  it("explains a failed authorization with retry and back", async () => {
    const onAuthorize = vi.fn()
    const onReset = vi.fn()
    const failed = reduceLoginState(waiting("register"), {
      type: "failed",
      error: "授权链接已过期",
    })
    await render({ state: failed, onAuthorize, onReset })

    expect(container.textContent).toContain("浏览器授权未完成")
    expect(container.textContent).toContain("授权链接已过期")
    await act(async () => button("重新授权")?.click())
    await act(async () => button("返回")?.click())
    expect(onAuthorize).toHaveBeenCalledWith("register")
    expect(onReset).toHaveBeenCalledOnce()
  })
})
