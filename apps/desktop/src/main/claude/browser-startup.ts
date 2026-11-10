// 负责等待浏览器完成扩展初始化，再打开本次授权页面。

import type { ChildProcess } from "node:child_process"
import { BrowserControlPipe } from "./browser-control-pipe"
import { expectedExtensionPaths } from "./browser-extension-paths"
import { createExtensionReadiness } from "./browser-extension-readiness"
import { EnvironmentBrowserClient } from "./environment-browser-client"
import { inspectAuthorizationEnvironment } from "./environment-check"
import type { EnvironmentCheckContext, EnvironmentCheckTargets } from "./environment-check-model"
import { environmentProgressPage, environmentReportPage } from "./environment-report-page"
import { environmentCheckTargets } from "./environment-targets"

const startupTimeoutMs = 20_000
const extensionsUrl = "chrome://extensions/"
const startupStages = {
  createPage: "创建授权窗口",
  extensionPaths: "读取扩展目录",
  createControl: "创建扩展状态页面",
  attachControl: "连接扩展状态页面",
  enableControl: "初始化扩展状态页面",
  loadControl: "加载扩展状态页面",
  registry: "读取扩展状态",
  closeControl: "关闭扩展状态页面",
  attachPage: "连接授权窗口",
  navigatePage: "打开授权页面",
  environmentCheck: "执行授权环境自检",
  detachPage: "完成授权窗口启动",
} as const

/** 浏览器启动未在规定时间内完成时使用的脱敏错误。 */
export class BrowserStartupTimeoutError extends Error {
  /** 创建标识超时阶段的错误，不包含授权地址或凭据。 */
  constructor(stage: keyof typeof startupStages) {
    super(`${startupStages[stage]}超时`)
    this.name = "BrowserStartupTimeoutError"
  }
}

/** 启动浏览器页面所需的本次进程、授权地址和取消条件。 */
export type BrowserStartupInput = {
  child: ChildProcess
  authorizeUrl: string
  signal?: AbortSignal
  assertCanNavigate?: () => void
  extensionArgs?: readonly string[]
  hostPlatform?: NodeJS.Platform
  environmentCheck?: EnvironmentCheckContext
  environmentTargets?: EnvironmentCheckTargets
  registerGracefulClose?: (close: () => boolean) => void
}

/** 扩展状态确认后才打开授权地址；无法确认时不打开授权页面。 */
export async function openAuthorizedPage(input: BrowserStartupInput): Promise<void> {
  const timeout = AbortSignal.timeout(input.environmentCheck ? 90_000 : startupTimeoutMs)
  const signal = input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout])
  const pipe = new BrowserControlPipe(input.child, signal)
  input.registerGracefulClose?.(() => pipe.requestClose())
  let stage: keyof typeof startupStages = "extensionPaths"
  try {
    const platform = input.hostPlatform ?? process.platform
    const paths = await pipe.race(
      withSignal(expectedExtensionPaths(input.extensionArgs ?? [], platform), signal),
    )
    stage = "createPage"
    const page = await pipe.request("Target.createTarget", { url: "about:blank" })
    const targetId = requiredString(page, "targetId")
    stage = "createControl"
    const control = await pipe.request("Target.createTarget", {
      url: "about:blank",
      hidden: true,
    })
    const controlId = requiredString(control, "targetId")
    stage = "attachControl"
    const controlSession = await attach(pipe, controlId)
    stage = "enableControl"
    await pipe.request("Runtime.enable", {}, controlSession)
    stage = "loadControl"
    const loaded = pipe.watch((message) => {
      if (message["sessionId"] !== controlSession) return false
      const params = message["params"]
      if (message["method"] !== "Runtime.executionContextCreated" || !isRecord(params)) return false
      const context = params["context"]
      if (!isRecord(context) || context["origin"] !== "chrome://extensions") return false
      const auxiliary = context["auxData"]
      return isRecord(auxiliary) && auxiliary["isDefault"] === true
    })
    try {
      await navigate(pipe, controlSession, extensionsUrl)
      await loaded.promise
    } finally {
      loaded.cancel()
    }
    stage = "registry"
    const waitForExtensions = await createExtensionReadiness({
      pipe,
      sessionId: controlSession,
      paths,
      platform,
    })
    await waitForExtensions()
    stage = "attachPage"
    const targetSession = await attach(pipe, targetId)
    stage = "registry"
    await waitForExtensions()
    signal.throwIfAborted()
    input.assertCanNavigate?.()
    if (input.environmentCheck) {
      stage = "environmentCheck"
      const client = new EnvironmentBrowserClient(pipe, signal)
      const page = { targetId, sessionId: targetSession }
      await client.command("Runtime.enable", {}, targetSession)
      await client.render(page, environmentProgressPage())
      const report = await inspectAuthorizationEnvironment(
        client,
        page,
        input.environmentCheck,
        input.environmentTargets ?? environmentCheckTargets,
      )
      signal.throwIfAborted()
      input.assertCanNavigate?.()
      await client.render(page, environmentReportPage(report, input.authorizeUrl))
      input.environmentCheck.request.onReport(report)
    } else {
      stage = "navigatePage"
      await navigate(pipe, targetSession, input.authorizeUrl)
    }
    stage = "closeControl"
    const closed = await pipe.request("Target.closeTarget", { targetId: controlId })
    if (closed["success"] !== true) throw new Error("无法关闭扩展状态页面")
    stage = "detachPage"
    await pipe.request("Target.detachFromTarget", { sessionId: targetSession })
    pipe.release()
  } catch (error: unknown) {
    pipe.close()
    if (timeout.aborted && !input.signal?.aborted) throw new BrowserStartupTimeoutError(stage)
    throw error
  }
}

async function withSignal<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
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
  })
}

async function attach(pipe: BrowserControlPipe, targetId: string): Promise<string> {
  const result = await pipe.request("Target.attachToTarget", { targetId, flatten: true })
  return requiredString(result, "sessionId")
}

async function navigate(pipe: BrowserControlPipe, sessionId: string, url: string): Promise<void> {
  const result = await pipe.request("Page.navigate", { url }, sessionId)
  if (result["errorText"] !== undefined) throw new Error("浏览器页面打开失败")
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key]
  if (typeof result !== "string" || result === "") throw new Error("浏览器控制响应无效")
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
