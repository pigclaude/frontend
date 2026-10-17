// 验证 pigclaude 使用权限登录的状态边界。
import { describe, expect, it } from "vitest"
import { createLoginState, reduceLoginState } from "./login-model"

describe("login model", () => {
  it("可以从密码登录切换到验证码登录", () => {
    const state = reduceLoginState(createLoginState(), { type: "set-mode", mode: "code" })
    expect(state.mode).toBe("code")
    expect(state.view).toBe("form")
  })

  it("空邮箱提交时停留在表单并给出错误", () => {
    const state = reduceLoginState(createLoginState(), {
      type: "submit",
      email: "",
      password: "secret",
    })
    expect(state.view).toBe("form")
    expect(state.error).toBe("请输入邮箱")
  })

  it("验证码模式必须填写验证码并在允许后进入成功态", () => {
    let state = reduceLoginState(createLoginState(), { type: "set-mode", mode: "code" })
    state = reduceLoginState(state, { type: "submit", email: "lin@example.com" })
    expect(state).toMatchObject({ view: "form", error: "请输入验证码" })
    state = reduceLoginState(state, {
      type: "submit",
      email: "lin@example.com",
      code: "123456",
    })
    expect(state.view).toBe("checking")
    expect(
      reduceLoginState(state, { type: "remote-allowed", checkedAt: "今天 09:00" }),
    ).toMatchObject({
      view: "success",
      checkedAt: "今天 09:00",
    })
  })

  it("远程拒绝和离线缓存分别进入拒绝与离线状态", () => {
    const checking = reduceLoginState(createLoginState(), {
      type: "submit",
      email: "lin@example.com",
      password: "secret",
    })
    expect(checking.view).toBe("checking")
    expect(reduceLoginState(checking, { type: "remote-denied" }).view).toBe("denied")
    expect(
      reduceLoginState(checking, {
        type: "offline",
        hasCachedAllow: true,
        checkedAt: "今天 09:00",
      }),
    ).toMatchObject({ view: "offline-allow", checkedAt: "今天 09:00" })
    expect(
      reduceLoginState(checking, { type: "offline", hasCachedAllow: false, checkedAt: null }).view,
    ).toBe("offline-none")
  })
})
