// 负责描述 pigclaude 使用权限登录的表单和结果状态。

/** 使用权限登录方式。 */
export type LoginMode = "password" | "code"

/** 使用权限登录页面状态。 */
export type LoginView =
  "form" | "checking" | "denied" | "offline-allow" | "offline-none" | "success"

/** 使用权限登录状态。 */
export type LoginState = {
  mode: LoginMode
  view: LoginView
  email: string
  error: string | null
  checkedAt: string | null
}

/** 使用权限登录状态变化事件。 */
export type LoginEvent =
  | { type: "set-mode"; mode: LoginMode }
  | { type: "submit"; email: string; password?: string; code?: string }
  | { type: "remote-denied" }
  | { type: "remote-allowed"; checkedAt: string }
  | { type: "offline"; hasCachedAllow: boolean; checkedAt: string | null }
  | { type: "reset" }

/** 创建初始的权限登录状态。 */
export function createLoginState(): LoginState {
  return { mode: "password", view: "form", email: "", error: null, checkedAt: null }
}

/** 按事件推进权限登录状态，不产生外部副作用。 */
export function reduceLoginState(state: LoginState, event: LoginEvent): LoginState {
  if (event.type === "set-mode") {
    return { ...state, mode: event.mode, error: null }
  }
  if (event.type === "submit") {
    const email = event.email.trim()
    if (!email) return { ...state, view: "form", email, error: "请输入邮箱" }
    if (state.mode === "code" && !event.code?.trim()) {
      return { ...state, view: "form", email, error: "请输入验证码" }
    }
    return { ...state, view: "checking", email, error: null }
  }
  if (event.type === "remote-denied") return { ...state, view: "denied", error: null }
  if (event.type === "remote-allowed") {
    return { ...state, view: "success", checkedAt: event.checkedAt, error: null }
  }
  if (event.type === "offline") {
    return {
      ...state,
      view: event.hasCachedAllow ? "offline-allow" : "offline-none",
      checkedAt: event.checkedAt,
      error: null,
    }
  }
  return createLoginState()
}
