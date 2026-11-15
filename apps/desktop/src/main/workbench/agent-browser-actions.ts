// 将已批准的导航、点击、输入和截图绑定到同一会话、窗口和浏览器文档。

import type { BrowserWindow } from "electron"
import type { BrowserNavigationTarget, BrowserTypeInput } from "../../browser-permission-contract"
import type { AgentBrowserScope } from "../../workbench-contract"
import {
  assertBrowserActionActive,
  awaitBrowserAction,
  navigateBrowserHistory,
  planBrowserNavigation,
  preparedBrowserAction,
} from "./browser-action-execution"
import { BrowserActionError, type PreparedBrowserAction } from "./browser-action-request"
import { prepareBrowserElementAction, type AgentElementAction } from "./browser-element-actions"
import { StaleBrowserReference } from "./browser-references"
import {
  BrowserScreenshotError,
  browserViewPixelSize,
  captureBrowserView,
  prepareBrowserScreenshot,
  type PreparedBrowserScreenshot,
} from "./browser-screenshot"
import type { AgentBrowserSurface } from "./browser-surface"

type Ports = {
  current(window: BrowserWindow, scope: AgentBrowserScope): AgentBrowserSurface | undefined
  create(window: BrowserWindow, scope: AgentBrowserScope): AgentBrowserSurface
  open(scope: AgentBrowserScope, entry: AgentBrowserSurface, url: string): void
  publish(id: string, entry: AgentBrowserSurface): void
  snapshot(window: BrowserWindow, scope: AgentBrowserScope): Promise<string>
}

/** Agent 浏览器操作的审批前读取和批准后执行；普通预览不走此入口。 */
export class AgentBrowserActions {
  /** 连接主进程维护的会话所有权，操作自身不创建或解析任意窗口标识。 */
  constructor(private readonly ports: Ports) {}

  /** 计划导航时只读现有历史；批准后再次核对文档及真实本机地址。 */
  prepareNavigation(
    window: BrowserWindow,
    scope: AgentBrowserScope,
    target: BrowserNavigationTarget,
  ): PreparedBrowserAction {
    const original = this.ports.current(window, scope)
    const verifyDocument = original?.agent.references.documentGuard()
    const { context, index } = planBrowserNavigation(original?.view.webContents, target)
    const intent = context.action === "url" ? { url: context.url } : { action: context.action }
    return preparedBrowserAction(context, async (signal, assertAllowed) => {
      if (signal) assertBrowserActionActive(signal)
      if (this.ports.current(window, scope) !== original) throw new StaleBrowserReference()
      verifyDocument?.()
      const entry = original ?? this.ports.create(window, scope)
      return this.#execute(
        scope,
        entry,
        context,
        20_000,
        signal,
        assertAllowed,
        async (control, verify) => {
          await awaitBrowserAction(entry.agent.network.ready, control)
          verify()
          verifyDocument?.()
          const contents = entry.view.webContents
          const current = planBrowserNavigation(contents, intent)
          if (current.context.url !== context.url || current.index !== index)
            throw new StaleBrowserReference()
          entry.error = undefined
          entry.crashed = undefined
          entry.pickVersion += 1
          entry.agent.references.invalidate()
          this.ports.open(scope, entry, context.url)
          verify()
          if (context.action === "url") await contents.loadURL(context.url)
          else await navigateBrowserHistory(contents, index, control)
        },
      )
    })
  }

  /** 读取角色与名称，获批后才滚动并对原浏览器核实真实命中。 */
  prepareClick(
    window: BrowserWindow,
    scope: AgentBrowserScope,
    ref: string,
  ): Promise<PreparedBrowserAction> {
    return this.#prepareElement(window, scope, { kind: "click", ref })
  }

  /** 只披露会话内真实字段和输入长度，批准后才使用原始文字。 */
  prepareType(
    window: BrowserWindow,
    scope: AgentBrowserScope,
    input: BrowserTypeInput,
  ): Promise<PreparedBrowserAction> {
    return this.#prepareElement(window, scope, { kind: "type", input: { ...input } })
  }

  async #prepareElement(
    window: BrowserWindow,
    scope: AgentBrowserScope,
    action: AgentElementAction,
  ): Promise<PreparedBrowserAction> {
    const entry = this.ports.current(window, scope)
    if (!entry || entry.error || entry.crashed) throw new StaleBrowserReference()
    const prepared = await prepareBrowserElementAction(
      entry.view.webContents,
      entry.agent.references,
      action,
    )
    const verifyDocument = () => {
      if (entry.error || entry.crashed) throw new StaleBrowserReference()
      prepared.verifyDocument()
    }
    if (this.ports.current(window, scope) !== entry) throw new StaleBrowserReference()
    verifyDocument()
    const { context } = prepared
    return preparedBrowserAction(context, (signal, assertAllowed) =>
      this.#execute(scope, entry, context, 10_000, signal, assertAllowed, (control, verify) => {
        const verifyTarget = () => {
          verify()
          verifyDocument()
        }
        verifyTarget()
        this.ports.open(scope, entry, context.url)
        return prepared.run(control, verifyTarget)
      }),
    )
  }

  /** 截图的显示和像素读取都使用同一条目，浏览器不可用时返回可读错误。 */
  prepareScreenshot(
    window: BrowserWindow,
    scope: AgentBrowserScope,
    signal?: AbortSignal,
    allowed: () => boolean = () => true,
  ): Promise<PreparedBrowserScreenshot> {
    const entry = this.ports.current(window, scope)
    const missing = "Open a local page in this session before requesting a screenshot."
    if (!entry) return Promise.reject(new BrowserScreenshotError(missing))
    const assertScope = () => {
      if (!allowed() || entry.error || entry.crashed || this.ports.current(window, scope) !== entry)
        throw new BrowserScreenshotError(missing)
    }
    return prepareBrowserScreenshot(
      entry.view.webContents,
      assertScope,
      () => browserViewPixelSize(window, entry.view),
      (validate, invocation) =>
        captureBrowserView(window, entry.view, () => entry.attached, validate, invocation),
      signal,
    )
  }

  async #execute(
    scope: AgentBrowserScope,
    entry: AgentBrowserSurface,
    context: PreparedBrowserAction["context"],
    timeout: number,
    signal: AbortSignal | undefined,
    assertAllowed: (() => void) | undefined,
    run: (control: AbortSignal, verify: () => void) => Promise<void>,
  ): Promise<string> {
    const deadline = AbortSignal.timeout(timeout)
    const control = signal ? AbortSignal.any([signal, deadline]) : deadline
    const verify = () => {
      assertBrowserActionActive(control)
      assertAllowed?.()
      if (this.ports.current(entry.window, scope) !== entry) throw new StaleBrowserReference()
    }
    verify()
    if (entry.activity)
      throw new BrowserActionError("Another approved browser action is still running.")
    entry.activity = {
      kind: context.kind,
      target: context.kind === "navigate" ? context.url : context.name || context.ref,
    }
    try {
      this.ports.publish(scope.id, entry)
      await awaitBrowserAction(run(control, verify), control)
      verify()
      const snapshot = await awaitBrowserAction(this.ports.snapshot(entry.window, scope), control)
      verify()
      return snapshot
    } catch (error) {
      if (error instanceof BrowserActionError) throw error
      throw new BrowserActionError(
        "The browser could not complete the approved action. Please take a new browser snapshot.",
      )
    } finally {
      delete entry.activity
      this.ports.publish(scope.id, entry)
    }
  }
}
