// 负责在实际 Electron 窗口核验外壳、原生菜单、整窗流程和设置跨进程持久化。
import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect } from "@playwright/test"
import { startMembershipFixture } from "./membership-fixture.mjs"
import { closeFromTitleBar, verifySystemControls } from "./window-controls.mjs"

const out = resolve(process.argv[2] ?? "test-results/native-desktop")
await mkdir(out, { recursive: true })
const userData = await mkdtemp(join(tmpdir(), "pigclaude-native-ui-"))
const fixture = await startMembershipFixture()
const report = { platform: process.platform, arch: process.arch, checks: [] }
const desktopPath = resolve("apps/desktop")
const electron = createRequire(join(desktopPath, "package.json"))("electron")
let application

function pass(check) {
  report.checks.push(check)
  console.log("PASS", check)
}

async function launch() {
  application = await _electron.launch({
    executablePath: electron,
    args: [
      desktopPath,
      ...(process.platform === "linux" ? ["--password-store=gnome-libsecret"] : []),
    ],
    env: {
      ...process.env,
      PIGCLAUDE_USER_DATA: userData,
      PIGCLAUDE_AUTH_ORIGIN: fixture.origin,
      PIGCLAUDE_RUST_BASE_URL: fixture.origin,
    },
    timeout: 45_000,
  })
  const page = await application.firstWindow({ timeout: 25_000 })
  page.setDefaultTimeout(10_000)
  await page.waitForFunction(() => !!window.pigclaude?.membership, null, { timeout: 15_000 })
  return page
}

async function closeApplication() {
  if (!application) return
  const current = application
  application = undefined
  const process = current.process()
  if (process.exitCode !== null || process.signalCode !== null) return
  const exited = new Promise((resolve) => process.once("exit", resolve))
  const timeout = setTimeout(() => process.kill("SIGKILL"), 7000)
  let deadline
  try {
    await Promise.race([
      current.close().catch(() => exited),
      exited,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Electron 退出超时")), 10_000)
      }),
    ])
  } finally {
    clearTimeout(timeout)
    clearTimeout(deadline)
  }
}

async function capture(page, name) {
  await page.screenshot({ path: join(out, `${name}.png`) })
}

function nativeState() {
  return application.evaluate(({ BrowserWindow, safeStorage, screen }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return {
      electron: process.versions.electron,
      osVersion: process.getSystemVersion(),
      platform: process.platform,
      scale: screen.getPrimaryDisplay().scaleFactor,
      bounds: window.getBounds(),
      min: window.getMinimumSize(),
      minimized: window.isMinimized(),
      maximized: window.isMaximized(),
      keyring: safeStorage.getSelectedStorageBackend?.(),
      encryption: safeStorage.isEncryptionAvailable(),
    }
  })
}

async function setWidth(width) {
  await application.evaluate(({ BrowserWindow }, width) => {
    BrowserWindow.getAllWindows()[0].setSize(width, 800)
  }, width)
}

function screen(page, id) {
  return page.locator(`[data-main-window][data-screen="${id}"]`)
}

try {
  let page = await launch()
  report.environment = await nativeState()
  assert.equal(report.environment.encryption, true)
  if (process.platform === "linux") assert.equal(report.environment.keyring, "gnome_libsecret")
  await expect(page.getByRole("heading", { name: "欢迎使用 PigClaude" })).toBeVisible()
  assert.equal(await page.locator("[data-main-window]").count(), 0)
  await capture(page, "login")
  pass("signed out remains in welcome, OS safeStorage available")
  const prepared = page.getByRole("button", { name: "复制链接", exact: true })
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(prepared).toBeEnabled({ timeout: 15_000 })
  await fixture.approve()
  await page.getByRole("button", { name: "稍后再说" }).waitFor()
  await capture(page, "onboarding")
  await page.getByRole("button", { name: "稍后再说" }).click()
  await expect(screen(page, "chat")).toBeVisible()
  const platform = await page.evaluate(() => document.documentElement.dataset.platform)
  assert.equal(platform, process.platform)
  if (platform === "darwin") {
    const window = await application.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0]
      return { position: target.getWindowButtonPosition(), visible: target.isVisible() }
    })
    assert.equal(window.visible, true)
    assert.deepEqual(window.position, { x: 14, y: 12 })
  } else {
    await expect(page.locator(".titlebar")).toBeVisible()
    await expect(page.locator(".titlebar button")).toHaveText(["文件", "编辑", "视图", "帮助"])
    const overlay = await page.evaluate(() => {
      const overlay = navigator.windowControlsOverlay
      const rect = overlay.getTitlebarAreaRect()
      const menu = document.querySelector(".titlebar-menus").getBoundingClientRect()
      return {
        visible: overlay.visible,
        height: rect.height,
        reserved: innerWidth - rect.width,
        inSafeArea: menu.left >= rect.left - 1 && menu.right <= rect.right + 1,
      }
    })
    assert.equal(overlay.visible, true)
    assert.equal(overlay.height, 36)
    assert.ok(overlay.reserved > 0)
    assert.equal(overlay.inSafeArea, true)
  }
  pass("real native title bar and system button reservation")
  await capture(page, "shell-wide")
  if (platform !== "darwin") {
    await verifySystemControls(application, page, nativeState, out)
    pass(
      "system pointer title-bar drag, native menu selection, side mouse buttons and window buttons",
    )
  }

  const separator = page.getByRole("separator").first()
  const original = await separator.boundingBox()
  assert.ok(original)
  await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2)
  await page.mouse.down()
  await page.mouse.move(original.x + original.width / 2 + 62, original.y + original.height / 2, {
    steps: 8,
  })
  await page.mouse.up()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pigclaude.sidebarWidth")))
    .toBe("322")
  await setWidth(900)
  const toggle = page.getByRole("button", { name: "展开侧栏", exact: true })
  await toggle.click()
  await expect(page.locator("[data-main-window]")).toHaveClass(/is-drawer-open/)
  await capture(page, "shell-narrow")
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-main-window]")).not.toHaveClass(/is-drawer-open/)
  await toggle.click()
  await page.locator(".drawer-scrim").click({ position: { x: 850, y: 360 } })
  await expect(page.locator("[data-main-window]")).not.toHaveClass(/is-drawer-open/)
  await setWidth(600)
  assert.equal((await nativeState()).min[0], 640)
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(640)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 640)
  await setWidth(1200)
  pass("sidebar drag, drawer Escape/overlay, and native 640px minimum")

  const mod = platform === "darwin" ? "Meta" : "Control"
  await page.keyboard.press(`${mod}+,`)
  await expect(screen(page, "general")).toBeVisible()
  await page.getByRole("button", { name: "外观", exact: true }).click()
  await expect(screen(page, "appearance")).toBeVisible()
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(screen(page, "general")).toBeVisible()
  await page.keyboard.press("Alt+ArrowRight")
  await expect(screen(page, "appearance")).toBeVisible()
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(screen(page, "general")).toBeVisible()
  await page.getByRole("button", { name: "关于", exact: true }).click()
  await page.keyboard.press("Alt+ArrowRight")
  await expect(screen(page, "about")).toBeVisible()
  await page.keyboard.press(`${mod}+k`)
  await expect(page.getByRole("dialog", { name: "行动" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.keyboard.press(`${mod}+n`)
  await expect(screen(page, "chat-new")).toBeVisible()
  await page.keyboard.press(`${mod}+b`)
  await expect(page.getByRole("button", { name: "展开侧栏", exact: true })).toBeVisible()
  await page.keyboard.press(`${mod}+b`)
  pass("native renderer shortcuts and history branch truncation")

  if (platform !== "darwin") {
    await page.evaluate(() => window.pigclaude.window.control("minimize"))
    await expect.poll(async () => (await nativeState()).minimized).toBe(true)
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
    await page.evaluate(() => window.pigclaude.window.control("maximize"))
    await expect.poll(async () => (await nativeState()).maximized).toBe(true)
    await page.evaluate(() => window.pigclaude.window.control("maximize"))
    await expect.poll(async () => (await nativeState()).maximized).toBe(false)
    pass("actual BrowserWindow minimize, restore and maximize IPC")
  }

  if (platform !== "darwin") {
    await closeFromTitleBar(application, page)
    pass("system window close button")
  }
  await closeApplication()
  page = await launch()
  await expect(screen(page, "chat")).toBeVisible()
  assert.equal(await page.evaluate(() => localStorage.getItem("pigclaude.sidebarWidth")), "322")
  pass("full Electron restart retains encrypted login and sidebar width")
  await page.getByRole("button", { name: "设置", exact: true }).click()
  await expect(screen(page, "general")).toBeVisible()
  await page.getByRole("button", { name: "Claude 账号", exact: true }).click()
  await page.getByRole("button", { name: "添加账号", exact: true }).click()
  await capture(page, "authorize")
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await expect(screen(page, "accounts")).toBeVisible()
  fixture.setMembership("expired")
  await page.evaluate(() => window.pigclaude.membership.inspect())
  await expect(page.getByRole("heading", { name: "会员已到期" })).toBeVisible()
  await capture(page, "recovery")
  assert.equal(await page.locator("[data-main-window]").count(), 0)
  pass("native authorization cancel and expired membership close the shell")
} catch (error) {
  report.error = String(error)
  const page = application?.windows()[0]
  if (page && !page.isClosed()) await capture(page, "failure").catch(() => {})
  throw error
} finally {
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2))
  await closeApplication().catch(() => {})
  await fixture.close()
  await rm(userData, { recursive: true, force: true })
}
