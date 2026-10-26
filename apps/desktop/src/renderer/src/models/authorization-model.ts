// 负责描述 Claude 账号授权向导、出口核对和浏览器回调状态。

import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"

/** Claude 账号授权向导当前步骤。 */
export type AuthorizationStep = "name" | "proxy" | "fingerprint" | "exit" | "waiting" | "completed"

/** Claude 账号授权向导状态；proxyId 为 null 表示不绑定代理、使用系统网络。 */
export type AuthorizationState = {
  step: AuthorizationStep
  accountName: string
  proxyId: string | null
  /** 已确认的完整指纹；null 表示还没走到指纹步骤。 */
  fingerprint: ClaudeFingerprintView | null
  bridgeExit: string
  daemonExit: string
  canLaunch: boolean
  approved: boolean
  sessionId: string | null
  authorizationUrl: string | null
  error: string | null
}

/** Claude 账号授权状态变化事件。 */
export type AuthorizationEvent =
  | { type: "set-name"; accountName: string }
  | { type: "set-proxy"; proxyId: string | null }
  | { type: "set-fingerprint"; fingerprint: ClaudeFingerprintView }
  | { type: "advance" }
  | { type: "back" }
  | { type: "set-exits"; bridgeExit: string; daemonExit: string }
  | { type: "check-exit" }
  | { type: "start"; sessionId: string; url: string }
  | { type: "approved" }
  | { type: "failed"; error: string }
  | { type: "reset" }

/** 创建初始的 Claude 账号授权状态。 */
export function createAuthorizationState(): AuthorizationState {
  return {
    step: "name",
    accountName: "",
    proxyId: null,
    fingerprint: null,
    bridgeExit: "",
    daemonExit: "",
    canLaunch: false,
    approved: false,
    sessionId: null,
    authorizationUrl: null,
    error: null,
  }
}

/** 按事件推进授权状态，不打开浏览器或写入凭据。 */
export function reduceAuthorizationState(
  state: AuthorizationState,
  event: AuthorizationEvent,
): AuthorizationState {
  if (event.type === "set-name") return { ...state, accountName: event.accountName, error: null }
  if (event.type === "set-proxy") return { ...state, proxyId: event.proxyId, error: null }
  if (event.type === "set-fingerprint") {
    return { ...state, fingerprint: event.fingerprint, error: null }
  }
  if (event.type === "advance") {
    const next: Record<AuthorizationStep, AuthorizationStep> = {
      name: "proxy",
      proxy: "fingerprint",
      fingerprint: "exit",
      exit: "exit",
      waiting: "waiting",
      completed: "completed",
    }
    return { ...state, step: next[state.step], error: null }
  }
  if (event.type === "back") {
    const previous: Record<AuthorizationStep, AuthorizationStep> = {
      name: "name",
      proxy: "name",
      fingerprint: "proxy",
      exit: "fingerprint",
      waiting: "exit",
      completed: "completed",
    }
    return { ...state, step: previous[state.step], error: null }
  }
  if (event.type === "set-exits") {
    return {
      ...state,
      step: "exit",
      bridgeExit: event.bridgeExit,
      daemonExit: event.daemonExit,
      error: null,
    }
  }
  if (event.type === "check-exit") {
    const canLaunch = state.bridgeExit !== "" && state.bridgeExit === state.daemonExit
    return {
      ...state,
      step: "exit",
      canLaunch,
      authorizationUrl: canLaunch ? state.authorizationUrl : null,
      error: null,
    }
  }
  if (event.type === "start" && state.canLaunch) {
    return {
      ...state,
      step: "waiting",
      approved: false,
      sessionId: event.sessionId,
      authorizationUrl: event.url,
      error: null,
    }
  }
  if (event.type === "approved" && state.step === "waiting") {
    return { ...state, step: "completed", approved: true, error: null }
  }
  if (event.type === "failed") return { ...state, error: event.error, approved: false }
  if (event.type === "reset") {
    return {
      ...state,
      step: "exit",
      canLaunch: false,
      approved: false,
      sessionId: null,
      authorizationUrl: null,
      error: null,
    }
  }
  return state
}
