// 仅在临时浏览器配置中安装合成扩展，用于验证重启后的扩展保留。

import { spawn, type ChildProcess } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { BrowserControlPipe } from "./browser-control-pipe"

/** 合成安装浏览器未确认退出时，提示调用方保留其临时配置。 */
export class SyntheticInstallerCleanupError extends Error {
  /** 创建不包含配置内容的清理错误。 */
  constructor() {
    super("无法确认合成浏览器退出")
    this.name = "SyntheticInstallerCleanupError"
  }
}

/** 在独立临时 profile 中安装测试扩展，并确认安装进程已退出。 */
export async function installSyntheticExtension(input: {
  binary: string
  profile: string
  extension: string
}): Promise<void> {
  await mkdir(input.profile, { recursive: true })
  const child = spawn(
    input.binary,
    [
      `--user-data-dir=${input.profile}`,
      "--headless=new",
      "--no-first-run",
      "--use-mock-keychain",
      "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging",
      "--no-startup-window",
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  )
  let pipe: BrowserControlPipe | undefined
  try {
    await waitForSpawn(child)
    pipe = new BrowserControlPipe(child, AbortSignal.timeout(15_000))
    const target = await pipe.request("Target.createTarget", { url: "about:blank" })
    const targetId = requiredString(target, "targetId")
    const attached = await pipe.request("Target.attachToTarget", { targetId, flatten: true })
    const sessionId = requiredString(attached, "sessionId")
    await pipe.request("Page.enable", {}, sessionId)
    let committed = false
    const loaded = pipe.watch((message) => {
      if (message["sessionId"] !== sessionId) return false
      const params = message["params"]
      if (message["method"] === "Page.frameNavigated" && isRecord(params)) {
        const frame = params["frame"]
        if (isRecord(frame) && frame["url"] === "chrome://extensions/") committed = true
      }
      return committed && message["method"] === "Page.domContentEventFired"
    })
    try {
      await pipe.request("Page.navigate", { url: "chrome://extensions/" }, sessionId)
      await loaded.promise
    } finally {
      loaded.cancel()
    }
    const developerMode = await pipe.request(
      "Runtime.evaluate",
      {
        expression:
          "(async()=>{await chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true});return (await chrome.developerPrivate.getProfileConfiguration()).inDeveloperMode})()",
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    )
    if (!isRecord(developerMode["result"]) || developerMode["result"]["value"] !== true) {
      throw new Error("无法设置合成配置的开发者模式")
    }
    await pipe.request("Extensions.loadUnpacked", { path: input.extension })
    void pipe.request("Browser.close").catch(() => undefined)
    if (!(await waitForExit(child, 5_000))) throw new Error("合成扩展安装浏览器未退出")
  } finally {
    try {
      if (child.pid !== undefined && !hasExited(child)) {
        try {
          child.kill("SIGTERM")
          if (!(await waitForExit(child, 2_000))) {
            child.kill("SIGKILL")
            if (!(await waitForExit(child, 2_000))) throw new SyntheticInstallerCleanupError()
          }
        } catch {
          if (!hasExited(child)) throw new SyntheticInstallerCleanupError()
        }
      }
    } finally {
      pipe?.close()
    }
  }
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off("exit", finish)
      resolve(false)
    }, timeoutMs)
    child.once("exit", finish)
  })
}

function hasExited(child: ChildProcess): boolean {
  return typeof child.exitCode === "number" || typeof child.signalCode === "string"
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key]
  if (typeof result !== "string" || result === "") throw new Error("合成浏览器响应无效")
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
