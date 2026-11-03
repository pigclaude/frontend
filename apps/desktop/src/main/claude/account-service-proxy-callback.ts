// 等待授权回调，并在 Xray 无法恢复时结束授权等待。

import type { ProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import { ClaudeAccountError } from "./errors"
import type { OAuthCallbackServer } from "./subscription-oauth"

/** Xray 无法恢复时结束回调等待，并通知授权流程。 */
export function watchProxyFailure(
  runtime: ProxyRuntime | null,
  controller: AbortController,
  callback: () => OAuthCallbackServer | null,
): void {
  const fail = (error: Error) => {
    callback()?.cancel()
    controller.abort(error)
  }
  void runtime?.failure?.then(fail, () =>
    fail(new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 代理不可用")),
  )
}

/** 返回授权码；浏览器关闭或 Xray 恢复失败时结束等待。 */
export async function waitForProxyCallback(
  callback: OAuthCallbackServer,
  runtime: ProxyRuntime | null,
  browserExited: Promise<void>,
): Promise<string> {
  const waiting: Array<Promise<string>> = [
    callback.waitForCode(),
    browserExited.then(() => {
      callback.cancel()
      throw new ClaudeAccountError("AUTHORIZATION_CANCELLED", "授权浏览器已关闭")
    }),
  ]
  if (runtime?.failure !== undefined) {
    waiting.push(
      runtime.failure.then((error) => {
        throw error
      }),
    )
  }
  return Promise.race(waiting)
}

/** 等待 Xray 的同端口恢复，并响应授权取消。 */
export async function waitForProxyReady(
  runtime: ProxyRuntime | null,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  const ready = runtime?.ready?.()
  if (ready !== undefined) {
    let abort: () => void = () => undefined
    try {
      await Promise.race([
        ready,
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(signal.reason)
          signal.addEventListener("abort", abort, { once: true })
          if (signal.aborted) abort()
        }),
      ])
    } finally {
      signal.removeEventListener("abort", abort)
    }
  }
  signal.throwIfAborted()
  runtime?.assertRunning?.()
}
