// 负责提供本文件的前端契约、组件或样式实现。
import { useCallback, useReducer } from "react"

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export interface CaptchaGateState {
  token: string
  disabled: boolean
  nonce: number
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export type CaptchaGateAction =
  | { type: "verified"; token: string }
  | { type: "invalidated" }
  | { type: "disabled" }
  | { type: "reset" }

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export const initialCaptchaGateState: CaptchaGateState = {
  token: "",
  disabled: false,
  nonce: 0,
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function captchaGateReducer(
  state: CaptchaGateState,
  action: CaptchaGateAction,
): CaptchaGateState {
  switch (action.type) {
    case "verified":
      return { ...state, token: action.token, disabled: false }
    case "invalidated":
      return { ...state, token: "" }
    case "disabled":
      return { ...state, token: "", disabled: true }
    case "reset":
      // CAPTCHA_INVALID 也可能来自“页面打开时关闭、提交前已重新开启”。必须退出
      // disabled 并换 key 重挂组件，否则页面会永久 ready=true、持续发送空 token。
      return { token: "", disabled: false, nonce: state.nonce + 1 }
  }
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function isCaptchaGateReady(state: CaptchaGateState): boolean {
  return state.token !== "" || state.disabled
}

/**
 * 执行一次受验证码保护的请求。后端一旦收到请求就会先消费 token；网络异常时客户端
 * 无法判断请求是否到达，因此无论成功或失败都只重置一次，绝不复用状态不明的 token。
 */
/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export async function runCaptchaAttempt<T>(
  token: string,
  reset: () => void,
  request: (captchaToken: string) => Promise<T>,
): Promise<T> {
  try {
    return await request(token)
  } finally {
    reset()
  }
}

/** 三端共用的一次性验证码门控状态，避免运行时开关恢复语义在各 app 漂移。 */
export function useCaptchaGate() {
  const [state, dispatch] = useReducer(captchaGateReducer, initialCaptchaGateState)
  const onVerified = useCallback((token: string) => dispatch({ type: "verified", token }), [])
  const onInvalidate = useCallback(() => dispatch({ type: "invalidated" }), [])
  const onDisabled = useCallback(() => dispatch({ type: "disabled" }), [])
  const reset = useCallback(() => dispatch({ type: "reset" }), [])
  const run = useCallback(
    <T>(request: (captchaToken: string) => Promise<T>) =>
      runCaptchaAttempt(state.token, reset, request),
    [reset, state.token],
  )

  return {
    ...state,
    ready: isCaptchaGateReady(state),
    onVerified,
    onInvalidate,
    onDisabled,
    reset,
    run,
  }
}
