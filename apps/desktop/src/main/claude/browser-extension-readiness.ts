// 等待浏览器报告本次指定的扩展已启用，并按真实目录核对路径。

import type { BrowserControlPipe } from "./browser-control-pipe"
import { matchingExtensionPaths } from "./browser-extension-resolver"

const watchExpression = `(() => {
  const state = { revision: 0, waiters: [] }
  chrome.developerPrivate.onItemStateChanged.addListener(() => {
    state.revision += 1
    for (const resolve of state.waiters.splice(0)) resolve(true)
  })
  globalThis.__pigclaudeExtensionWatch = state
  return true
})()`

function snapshotExpression(includePaths: boolean): string {
  return `(async () => {
    const state = globalThis.__pigclaudeExtensionWatch
    const revision = state.revision
    const list = await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true })
    if (!Array.isArray(list)) throw new Error("invalid extension list")
    const paths = ${includePaths} ? list.filter((item) => item.state === "ENABLED" && item.location === "UNPACKED" && typeof item.path === "string").map((item) => item.path) : []
    return { revision, paths }
  })()`
}

function waitExpression(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("扩展状态版本无效")
  return `(() => new Promise((resolve) => {
    const state = globalThis.__pigclaudeExtensionWatch
    if (state.revision !== ${revision}) resolve(true)
    else state.waiters.push(resolve)
  }))()`
}

type ReadinessInput = {
  pipe: BrowserControlPipe
  sessionId: string
  paths: readonly string[]
  platform: NodeJS.Platform
}

/** 创建可重复核对的扩展状态检查；无法建立监听时明确失败。 */
export async function createExtensionReadiness(
  input: ReadinessInput,
): Promise<() => Promise<void>> {
  if ((await evaluate(input.pipe, input.sessionId, watchExpression)) !== true) {
    throw new Error("无法监听浏览器扩展状态")
  }
  return () => waitForExpectedExtensions(input)
}

async function waitForExpectedExtensions(input: ReadinessInput): Promise<void> {
  while (true) {
    const snapshot = await evaluate(
      input.pipe,
      input.sessionId,
      snapshotExpression(input.paths.length > 0),
    )
    if (
      !isRecord(snapshot) ||
      typeof snapshot["revision"] !== "number" ||
      !Array.isArray(snapshot["paths"]) ||
      !snapshot["paths"].every((path: unknown) => typeof path === "string")
    ) {
      throw new Error("浏览器扩展状态无效")
    }
    const matched = await input.pipe.race(
      matchingExtensionPaths(input.paths, snapshot["paths"] as string[], input.platform),
    )
    if (matched) {
      const revision = await evaluate(
        input.pipe,
        input.sessionId,
        "globalThis.__pigclaudeExtensionWatch.revision",
      )
      if (typeof revision !== "number") throw new Error("浏览器扩展状态无效")
      if (revision === snapshot["revision"]) return
      continue
    }
    await evaluate(input.pipe, input.sessionId, waitExpression(snapshot["revision"]))
  }
}

async function evaluate(
  pipe: BrowserControlPipe,
  sessionId: string,
  expression: string,
): Promise<unknown> {
  const response = await pipe.request(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  )
  if (response["exceptionDetails"] !== undefined || !isRecord(response["result"])) {
    throw new Error("无法确认浏览器扩展状态")
  }
  return response["result"]["value"]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
