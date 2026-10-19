// 负责从已安装 macOS bundle 启动真实 Electron，并观察 LaunchServices 私有协议派发。
import { _electron, chromium, expect, type ElectronApplication } from "@playwright/test"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import type { PigclaudeBridge } from "../apps/desktop/src/preload"
import type { DesktopHarness } from "./phase1-electron-harness"
import { OwnedProcess, cleanupFailedLaunch } from "./phase1-owned-process"

const execute = promisify(execFile)
type ObservedGlobal = typeof globalThis & { pigclaudeProtocolEvents?: number }
type BridgeWindow = Window & { pigclaude: PigclaudeBridge; pigclaudeProtocolStatus?: string }

/** 安装版必须自带的公开本地 endpoint 元数据。 */
export type PackagedEndpoints = { rustBaseUrl: string; authOrigin: string }

/** 强制读取真实验收环境；缺配置时失败而不是跳过。 */
export function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`安装版验收缺少 ${name}`)
  return value
}

/** 仅继承普通系统环境，不把测试凭据或 endpoint 传给安装 app。 */
function installedEnvironment(userData: string): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const key of [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "TMPDIR",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "__CF_USER_TEXT_ENCODING",
  ]) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  return { ...environment, PIGCLAUDE_USER_DATA: userData }
}

/** 启动已安装可执行文件，保证 packaged 分支、真实加密和隔离 profile 均生效。 */
export async function launchInstalled(
  installedApp: string,
  userData: string,
  endpoints: PackagedEndpoints,
  owners: Set<OwnedProcess>,
): Promise<DesktopHarness> {
  const owner = new OwnedProcess(join(installedApp, "Contents/MacOS/PigClaude"))
  owners.add(owner)
  owner.beginLaunch()
  const application = await _electron
    .launch({
      executablePath: join(installedApp, "Contents/MacOS/PigClaude"),
      env: installedEnvironment(userData),
      args: [owner.marker],
      timeout: 30_000,
    })
    .catch(async (error: unknown) => {
      await owner.cleanup()
      throw error
    })
  try {
    await owner.capture()
    const desktop: DesktopHarness = {
      application,
      owner,
      window: await application.firstWindow(),
      child: application.process(),
      closed: false,
    }
    const runtime = await application.evaluate(({ app, safeStorage }) => ({
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      executable: app.getPath("exe"),
      userData: app.getPath("userData"),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      endpointEnvironmentAbsent:
        !process.env["PIGCLAUDE_RUST_BASE_URL"] && !process.env["PIGCLAUDE_AUTH_ORIGIN"],
    }))
    expect(runtime).toEqual({
      packaged: true,
      appPath: join(installedApp, "Contents/Resources/app.asar"),
      executable: join(installedApp, "Contents/MacOS/PigClaude"),
      userData,
      encryptionAvailable: true,
      endpointEnvironmentAbsent: true,
    })
    const requireDesktop = createRequire(resolve("apps/desktop/package.json"))
    const requireBuilder = createRequire(requireDesktop.resolve("electron-builder/package.json"))
    const requireAppBuilder = createRequire(requireBuilder.resolve("app-builder-lib/package.json"))
    const asar = requireAppBuilder("@electron/asar") as {
      extractFile: (archive: string, filename: string) => Buffer
    }
    const metadata = JSON.parse(
      asar.extractFile(runtime.appPath, "package.json").toString("utf8"),
    ) as {
      pigclaudeEndpoints?: PackagedEndpoints
    }
    expect(metadata.pigclaudeEndpoints).toEqual(endpoints)
    const info = await execute("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleIdentifier",
      join(installedApp, "Contents/Info.plist"),
    ])
    expect(info.stdout.trim()).toBe("com.pigclaude.desktop")
    await application.evaluate(({ app }) => {
      const observed = globalThis as ObservedGlobal
      observed.pigclaudeProtocolEvents = 0
      app.on("open-url", (_event, url) => {
        if (url.startsWith("pigclaude://authorize/callback?")) {
          observed.pigclaudeProtocolEvents = (observed.pigclaudeProtocolEvents ?? 0) + 1
        }
      })
    })
    await desktop.window.waitForFunction(() =>
      Boolean((window as unknown as BridgeWindow).pigclaude?.authorization),
    )
    return desktop
  } catch (error: unknown) {
    if (!(await cleanupFailedLaunch(owner, () => application.close()))) {
      throw new Error("安装 app 退出未确认；保留本次验收 profile")
    }
    throw error
  }
}

/** 读取只计数、不保存 callback URL 或 code 的原生事件观察值。 */
export async function protocolEventCount(application: ElectronApplication): Promise<number> {
  return application.evaluate(() => (globalThis as ObservedGlobal).pigclaudeProtocolEvents ?? 0)
}

/** 调用系统 URL opener，经真实 LaunchServices 派发而不注入 Electron 事件。 */
export async function dispatchProtocol(url: string): Promise<void> {
  try {
    await execute("/usr/bin/open", [url], { env: installedEnvironment("") })
  } catch {
    throw new Error("macOS LaunchServices URL 派发失败")
  }
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("冷启动调试端口分配失败")
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}

async function installedProcessIds(installedApp: string): Promise<number[]> {
  const { stdout } = await execute("/bin/ps", ["-axo", "pid=,comm="])
  const executable = join(installedApp, "Contents/MacOS/PigClaude")
  return stdout.split("\n").flatMap((line) => {
    const matched = /^\s*(\d+)\s+(.+)$/.exec(line)
    return matched?.[2] === executable ? [Number(matched[1])] : []
  })
}

/** 以真实 OS URL 冷启动安装 app；未知会话必须保持 signed_out，且只清理本次进程。 */
export async function verifyColdProtocolRejection(
  installedApp: string,
  userData: string,
  owner: OwnedProcess,
): Promise<void> {
  expect(await installedProcessIds(installedApp)).toEqual([])
  const port = await unusedPort()
  const callback = "pigclaude://authorize/callback?code=cold-probe&state=cold-probe"
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    owner.beginLaunch()
    await execute(
      "/usr/bin/open",
      [
        "--env",
        `PIGCLAUDE_USER_DATA=${userData}`,
        callback,
        "--args",
        `--remote-debugging-port=${port}`,
        "--remote-debugging-address=127.0.0.1",
        owner.marker,
      ],
      { env: installedEnvironment("") },
    )
    await expect.poll(async () => (await owner.capture()).length).toBe(1)
    await expect
      .poll(async () => {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null)
        return response?.ok ?? false
      })
      .toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const renderer = browser.contexts()[0]?.pages()[0]
    if (!renderer) throw new Error("OS 冷启动未创建 renderer")
    await renderer.waitForFunction(() => Boolean((window as unknown as BridgeWindow).pigclaude))
    await expect
      .poll(() =>
        renderer
          .evaluate(() => (window as unknown as BridgeWindow).pigclaude.membership.inspect())
          .then((view) => view?.state),
      )
      .toBe("signed_out")
    await renderer.evaluate(() => {
      const observed = window as unknown as BridgeWindow
      observed.pigclaude.authorization.subscribe((event) => {
        observed.pigclaudeProtocolStatus = event.status
      })
    })
    await dispatchProtocol(callback)
    await expect
      .poll(() =>
        renderer.evaluate(() => (window as unknown as BridgeWindow).pigclaudeProtocolStatus),
      )
      .toBe("state-mismatch")
    await expect(renderer.locator(".app")).toHaveCount(0)
    const secrets = JSON.parse(
      await readFile(join(userData, "authorization-secrets.json"), "utf8"),
    ) as Record<string, string>
    expect(Object.hasOwn(secrets, "membership:session")).toBe(false)
  } finally {
    await browser?.close().catch(() => undefined)
    if (!(await owner.cleanup())) {
      throw new Error("冷启动进程退出未确认；保留本次验收 profile")
    }
  }
}
