// 在已批准的 Agent 标签上发送原生鼠标与历史导航动作，并有界等待加载。

import { setTimeout as delay } from "node:timers/promises"
import type { WebContents } from "electron"
import type { BrowserNavigationTarget, BrowserTypeInput } from "../../browser-permission-contract"
import { BrowserActionError, type PreparedBrowserAction } from "./browser-action-request"
import { workbenchAgentBrowserUrl } from "./browser-context"
import { StaleBrowserReference, type AgentBrowserPoint } from "./browser-references"

/** 从输入或当前页的历史中读取实际本机目标，不改变浏览器状态。 */
export function planBrowserNavigation(
  contents: WebContents | undefined,
  target: BrowserNavigationTarget,
): {
  context: Extract<PreparedBrowserAction["context"], { kind: "navigate" }>
  index: number | null
} {
  let url: string
  let index: number | null = null
  const action = "url" in target ? "url" : target.action
  if ("url" in target) {
    url = target.url
  } else {
    if (!contents)
      throw new BrowserActionError(
        "Please open an Agent browser page before navigating its history.",
      )
    url = contents.getURL()
    if (target.action !== "reload") {
      const history = contents.navigationHistory
      const offset = target.action === "back" ? -1 : 1
      index = history.getActiveIndex() + offset
      const entry = history.canGoToOffset(offset) ? history.getEntryAtIndex(index) : null
      if (!entry)
        throw new BrowserActionError("There is no browser history entry in that direction.")
      url = entry.url
    }
  }
  try {
    return { context: { kind: "navigate", action, url: workbenchAgentBrowserUrl(url).href }, index }
  } catch {
    throw new BrowserActionError(
      "The Agent browser can only navigate to an HTTP(S) loopback address.",
    )
  }
}

/** 让一次待批准的请求只执行一次；开始动作后重试仍需新批准。 */
export function preparedBrowserAction(
  context: PreparedBrowserAction["context"],
  run: PreparedBrowserAction["execute"],
): PreparedBrowserAction {
  let used = false
  return {
    context: { ...context },
    async execute(signal, assertAllowed) {
      if (used)
        throw new BrowserActionError("This browser action already ran. Request approval again.")
      used = true
      assertAllowed?.()
      return run(signal, assertAllowed)
    },
  }
}

/** 在动作已被取消或到达截止时返回固定的错误说明。 */
export function assertBrowserActionActive(signal: AbortSignal): void {
  if (signal.aborted) throw cancellation(signal)
}

/** 将等待限制到当次动作的信号；移除已经结算的监听。 */
export function awaitBrowserAction<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(cancellation(signal))
    }
    signal.addEventListener("abort", abort, { once: true })
    void task.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
    if (signal.aborted) abort()
  })
}

/** 跳到已核对的历史索引，或重新加载当前项。 */
export function navigateBrowserHistory(
  contents: WebContents,
  index: number | null,
  signal: AbortSignal,
): Promise<void> {
  return waitForPageLoad(contents, signal, () => {
    if (index === null) contents.reload()
    else contents.navigationHistory.goToIndex(index)
  })
}

/** 通过目标 WebContents 的 CDP 发送一次左键，随后等待当前加载。 */
export async function clickBrowserPoint(
  contents: WebContents,
  hit: () => Promise<AgentBrowserPoint>,
  assertCurrent: () => void,
  signal: AbortSignal,
): Promise<void> {
  await inBrowserDebugger(contents, signal, async (debuggerPort) => {
    const { x, y } = await awaitBrowserAction(hit(), signal)
    assertCurrent()
    const pointer = { x, y, button: "left", clickCount: 1 }
    await awaitBrowserAction(
      debuggerPort.sendCommand("Input.dispatchMouseEvent", {
        ...pointer,
        type: "mousePressed",
        buttons: 1,
      }),
      signal,
    )
    assertCurrent()
    await awaitBrowserAction(
      debuggerPort.sendCommand("Input.dispatchMouseEvent", {
        ...pointer,
        type: "mouseReleased",
        buttons: 0,
      }),
      signal,
    )
  })
  await waitAfterBrowserAction(contents, signal)
}

/** 仅在目标页中发出编辑与回车事件，并在每次 CDP 输入前确认焦点和权限。 */
export async function typeInBrowserField(
  contents: WebContents,
  input: BrowserTypeInput,
  field: { focus(): Promise<void>; checkFocus(): Promise<void>; sameDocument(): boolean },
  assertCurrent: () => void,
  signal: AbortSignal,
): Promise<void> {
  await inBrowserDebugger(contents, signal, async (debuggerPort) => {
    async function send(method: "Input.dispatchKeyEvent" | "Input.insertText", params: object) {
      assertCurrent()
      await awaitBrowserAction(field.checkFocus(), signal)
      assertCurrent()
      await awaitBrowserAction(debuggerPort.sendCommand(method, params), signal)
    }

    assertCurrent()
    await awaitBrowserAction(field.focus(), signal)

    if (input.clear) {
      const backspace = { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }
      await send("Input.dispatchKeyEvent", {
        ...backspace,
        type: "rawKeyDown",
        commands: ["SelectAll", "DeleteBackward"],
      })
      await send("Input.dispatchKeyEvent", { ...backspace, type: "keyUp" })
    }
    if (input.text.length > 0) await send("Input.insertText", { text: input.text })
    if (input.submit) {
      const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }
      await send("Input.dispatchKeyEvent", {
        ...enter,
        type: "keyDown",
        text: "\r",
        unmodifiedText: "\r",
      })
      try {
        if (field.sameDocument()) await send("Input.dispatchKeyEvent", { ...enter, type: "keyUp" })
      } catch (error) {
        // 回车可能已提交并触发导航，不能把松键补发到新文档。
        if (!(error instanceof StaleBrowserReference) || field.sameDocument()) throw error
      }
    }
  })
  await waitAfterBrowserAction(contents, signal)
}

async function inBrowserDebugger(
  contents: WebContents,
  signal: AbortSignal,
  run: (debuggerPort: WebContents["debugger"]) => Promise<void>,
): Promise<void> {
  assertBrowserActionActive(signal)
  const debuggerPort = contents.debugger
  if (debuggerPort.isAttached())
    throw new BrowserActionError(
      "The browser is already being debugged. Close the debugger and retry.",
    )
  debuggerPort.attach("1.3")
  try {
    await run(debuggerPort)
  } finally {
    if (!contents.isDestroyed() && debuggerPort.isAttached()) debuggerPort.detach()
  }
}

async function waitAfterBrowserAction(contents: WebContents, signal: AbortSignal): Promise<void> {
  // 给页面处理输入并启动加载的机会；未导航时也能返回即时更新的正文。
  await awaitBrowserAction(delay(150), signal)
  await waitForPageLoad(contents, signal)
}

function waitForPageLoad(
  contents: WebContents,
  signal: AbortSignal,
  startNavigation?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let committed = startNavigation === undefined
    const complete = (error?: unknown) => {
      contents.off("did-navigate", navigated)
      contents.off("did-navigate-in-page", inPage)
      contents.off("did-stop-loading", stopped)
      contents.off("did-fail-load", failed)
      contents.off("destroyed", disconnected)
      contents.off("render-process-gone", disconnected)
      signal.removeEventListener("abort", aborted)
      if (error === undefined) resolve()
      else reject(error)
    }
    const stopped = () => {
      if (committed && !contents.isLoading()) complete()
    }
    const navigated = () => {
      committed = true
      stopped()
    }
    const inPage = (_event: Electron.Event, _url: string, isMainFrame: boolean) => {
      if (isMainFrame) navigated()
    }
    const failed = (
      _event: Electron.Event,
      _code: number,
      _description: string,
      _url: string,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame)
        complete(new BrowserActionError("The browser page failed to load. Please try again."))
    }
    const disconnected = () =>
      complete(new BrowserActionError("The browser closed. Please open a new page."))
    const aborted = () => complete(cancellation(signal))
    contents.on("did-navigate", navigated)
    contents.on("did-navigate-in-page", inPage)
    contents.on("did-stop-loading", stopped)
    contents.on("did-fail-load", failed)
    contents.on("destroyed", disconnected)
    contents.on("render-process-gone", disconnected)
    signal.addEventListener("abort", aborted, { once: true })
    try {
      assertBrowserActionActive(signal)
      if (contents.isDestroyed()) return disconnected()
      if (startNavigation) startNavigation()
      else stopped()
    } catch (error) {
      complete(error)
    }
  })
}

function cancellation(signal: AbortSignal): BrowserActionError {
  const reason: unknown = signal.reason
  const timedOut = reason instanceof DOMException && reason.name === "TimeoutError"
  return new BrowserActionError(
    timedOut
      ? "The browser action timed out. Please take a new browser snapshot before retrying."
      : "The browser action was cancelled.",
  )
}
