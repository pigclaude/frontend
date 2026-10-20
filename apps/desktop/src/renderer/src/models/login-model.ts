// 负责描述 PigClaude 登录/注册浏览器授权的纯状态机。

/** PigClaude 浏览器授权意图。保证登录和注册显示不同的浏览器文案。 */
export type LoginIntent = "login" | "register"

/**
 * 浏览器授权登录页面状态。保证 renderer 只保存脱敏授权结果。
 * `confirming` 表示浏览器授权已完成、正在等会员结果；没有单独的成功页。
 */
export type LoginView = "idle" | "starting" | "waiting" | "confirming" | "error"

/** PigClaude 登录/注册状态。保证 token 不进入 React 状态。 */
export type LoginState = {
  view: LoginView
  intent: LoginIntent | null
  sessionId: string | null
  authorizationUrl: string | null
  expiresAt: number | null
  displayName: string | null
  error: string | null
}

/** 浏览器授权登录状态变化事件。 */
export type LoginEvent =
  | { type: "start-request"; intent: LoginIntent }
  | {
      type: "started"
      intent: LoginIntent
      sessionId: string
      authorizationUrl: string
      expiresAt: number
    }
  | {
      type: "completed"
      intent: LoginIntent
      sessionId: string
      displayName: string
      expiresAt: number
    }
  | { type: "failed"; error: string }
  | { type: "cancelled" }
  | { type: "reset" }

/** 创建空闲的浏览器授权登录状态。 */
export function createLoginState(): LoginState {
  return {
    view: "idle",
    intent: null,
    sessionId: null,
    authorizationUrl: null,
    expiresAt: null,
    displayName: null,
    error: null,
  }
}

/** 按事件推进浏览器授权状态，不产生外部副作用。 */
export function reduceLoginState(state: LoginState, event: LoginEvent): LoginState {
  if (event.type === "start-request") {
    return {
      ...state,
      view: "starting",
      intent: event.intent,
      sessionId: null,
      authorizationUrl: null,
      expiresAt: null,
      displayName: null,
      error: null,
    }
  }
  if (event.type === "started") {
    return {
      ...state,
      view: "waiting",
      intent: event.intent,
      sessionId: event.sessionId,
      authorizationUrl: event.authorizationUrl,
      expiresAt: event.expiresAt,
      error: null,
    }
  }
  if (event.type === "completed") {
    return {
      ...state,
      view: "confirming",
      intent: event.intent,
      sessionId: event.sessionId,
      displayName: event.displayName,
      expiresAt: event.expiresAt,
      error: null,
    }
  }
  if (event.type === "failed") return { ...state, view: "error", error: event.error }
  if (event.type === "cancelled" || event.type === "reset") return createLoginState()
  return state
}
