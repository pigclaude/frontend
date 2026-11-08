// 等待授权回调，并在 Xray 无法恢复时结束授权等待。

import type { ProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import { BrowserProcessExitedError } from "./browser-control-pipe"
import { ClaudeAccountError } from "./errors"
import type { LaunchedBrowser } from "./fingerprint-chromium"
import type { OAuthCallbackServer } from "./subscription-oauth"

type CallbackOutcome = { kind: "code"; code: string } | { kind: "error"; error: unknown }

class CallbackCompletedBeforeNavigation extends Error {}

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

/** 观察启动期间可能到达的回调，并保留浏览器实例供调用方清理。 */
export async function launchAndWaitForCallback(input: {
  launch: (signal: AbortSignal, assertCallbackPending: () => void) => Promise<LaunchedBrowser>
  callback: OAuthCallbackServer
  runtime: ProxyRuntime | null
  signal: AbortSignal
  onLaunched: (browser: LaunchedBrowser) => void
  checkpoint: () => void
}): Promise<string> {
  const callbackFailure = new AbortController()
  const launchSignal = AbortSignal.any([input.signal, callbackFailure.signal])
  const observed: Promise<CallbackOutcome> = input.callback.waitForCode().then(
    (code) => ({ kind: "code", code }),
    (error: unknown) => {
      callbackFailure.abort(error)
      return { kind: "error", error }
    },
  )
  let browser: LaunchedBrowser
  try {
    browser = await input.launch(launchSignal, () => {
      if (input.callback.isComplete()) throw new CallbackCompletedBeforeNavigation()
    })
  } catch (error: unknown) {
    if (
      error instanceof CallbackCompletedBeforeNavigation ||
      (error instanceof BrowserProcessExitedError && input.callback.isComplete())
    ) {
      input.checkpoint()
      return input.callback.waitForCode()
    }
    input.callback.cancel()
    throw error
  }
  input.onLaunched(browser)
  input.checkpoint()
  return waitForProxyCallback(input.callback, input.runtime, browser.exited, observed)
}

async function waitForProxyCallback(
  callback: OAuthCallbackServer,
  runtime: ProxyRuntime | null,
  browserExited: Promise<void>,
  observed: Promise<CallbackOutcome>,
): Promise<string> {
  const waiting: Array<Promise<CallbackOutcome>> = [
    observed,
    browserExited.then(async () => {
      if (callback.isComplete()) return { kind: "code", code: await callback.waitForCode() }
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
  return callbackCode(await Promise.race(waiting))
}

function callbackCode(outcome: CallbackOutcome): string {
  if (outcome.kind === "error") throw outcome.error
  return outcome.code
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
