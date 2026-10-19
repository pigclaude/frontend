// 负责启动真实生产构建 Electron，并只通过既有 preload 操作授权和会员门禁。
import { _electron, expect, type ElectronApplication, type Page } from "@playwright/test"
import type { ChildProcess } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { parseOAuthDesktopSession } from "../apps/desktop/src/main/authorization/oauth-session"
import type { OAuthDesktopSession } from "../packages/contracts/src/desktop-membership"
import type { MembershipView } from "../packages/contracts/src/membership"
import { OwnedProcess, cleanupFailedLaunch } from "./phase1-owned-process"
import { desktopEnvironment } from "./phase1-production-desktop-support"
import type { PigclaudeBridge } from "../apps/desktop/src/preload"

type BridgeWindow = Window & { pigclaude: PigclaudeBridge }

/** 真实 Electron 进程及其生产 renderer 窗口。 */
export type DesktopHarness = {
  application: ElectronApplication
  window: Page
  child: ChildProcess
  owner: OwnedProcess
  closed: boolean
}

/** 启动隔离 userData 的生产构建，保留真实 safeStorage、HTTP 和 IPC。 */
export async function launchDesktop(
  userData: string,
  rustUrl: string,
  homeUrl: string,
  owners?: Set<OwnedProcess>,
): Promise<DesktopHarness> {
  const requireDesktop = createRequire(resolve("apps/desktop/package.json"))
  const executablePath = requireDesktop("electron") as string
  const owner = new OwnedProcess(executablePath)
  owners?.add(owner)
  owner.beginLaunch()
  const application = await _electron.launch({
    executablePath,
    args: [resolve("apps/desktop"), owner.marker],
    env: desktopEnvironment(process.env, userData, rustUrl, homeUrl),
    timeout: 30_000,
  })
  const child = application.process()
  try {
    await owner.capture()
    expect(await application.evaluate(({ app }) => app.getPath("userData"))).toBe(userData)
    expect(
      await application.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()),
    ).toBe(true)
    const renderer = await application.firstWindow()
    await renderer.waitForFunction(() =>
      Boolean((window as unknown as BridgeWindow).pigclaude?.authorization),
    )
    return { application, window: renderer, child, owner, closed: false }
  } catch (error: unknown) {
    await cleanupFailedLaunch(owner, () => application.close())
    throw error
  }
}

/** 幂等关闭本次启动的真实进程；异常时只终止已保存的该进程，不访问失效 transport。 */
export async function closeDesktop(desktop: DesktopHarness): Promise<void> {
  if (desktop.closed) return
  if (!(await cleanupFailedLaunch(desktop.owner, () => desktop.application.close())))
    throw new Error("验收 Electron 归属进程退出未确认")
  desktop.closed = true
}

/** 通过生产 preload 发起真实 PKCE 授权，返回服务端生成的浏览器地址。 */
export async function startDesktopAuthorization(desktop: DesktopHarness): Promise<string> {
  const started = await desktop.window.evaluate(async () => {
    const bridge = (window as unknown as BridgeWindow).pigclaude
    return bridge.authorization.start({ purpose: "pigclaude-login", mode: "login" })
  })
  if (started.ok === false) throw new Error(`真实桌面授权启动失败：${started.status}`)
  return started.authorizationUrl
}

/** 重新执行主进程服务端校验，不修改缓存或绕过门禁。 */
export async function inspectDesktop(desktop: DesktopHarness): Promise<MembershipView | null> {
  return desktop.window.evaluate(() =>
    (window as unknown as BridgeWindow).pigclaude.membership.inspect(),
  )
}

/** 等待真实会员状态，失败信息只包含脱敏 state。 */
export async function expectDesktopState(desktop: DesktopHarness, state: string): Promise<void> {
  await expect.poll(async () => (await inspectDesktop(desktop))?.state).toBe(state)
}

/** 测试读取系统 safeStorage 的既有持久快照，秘密只保留在测试进程内存中。 */
export async function readDesktopSession(desktop: DesktopHarness): Promise<OAuthDesktopSession> {
  const userData = await desktop.application.evaluate(({ app }) => app.getPath("userData"))
  const encrypted = JSON.parse(
    await readFile(join(userData, "authorization-secrets.json"), "utf8"),
  ) as Record<string, string>
  const encoded = encrypted["membership:session"]
  if (!encoded) throw new Error("真实 safeStorage 尚未写入 membership session")
  const raw = await desktop.application.evaluate(
    ({ safeStorage }, ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, "base64")),
    encoded,
  )
  const record = parseOAuthDesktopSession(raw)
  if (!record) throw new Error("当前OAuth记录缺失或无效")
  return record
}
