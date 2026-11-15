// 从当前源码 DMG 安装隔离副本，使用真实 LaunchServices 与本机合成授权验证桌面安装态。
import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { promisify } from "node:util"
import { chromium, expect } from "@playwright/test"
import { startMembershipFixture } from "./installed-membership-fixture.mjs"

const run = promisify(execFile)
const root = await realpath(process.argv[2])
const win = process.platform === "win32"
const release = await realpath(process.argv[3])
const installerName = (await readdir(release)).find((file) =>
  win ? /^PigClaude-.*\.exe$/i.test(file) : /^PigClaude-.*\.dmg$/i.test(file),
)
assert(installerName)
const installer = join(release, installerName)
const mount = join(root, "mount")
const installDir = win ? join(root, "installed-pigclaude") : join(root, "Applications")
const installed = win ? installDir : join(installDir, "PigClaude.app")
const userData = join(root, "profile")
const executable = win
  ? join(installed, "PigClaude.exe")
  : join(installed, "Contents", "MacOS", "PigClaude")
const fixture = await startMembershipFixture(true)
const coldCallback = "pigclaude://authorize/callback?code=cold-fixture&state=cold-fixture"
const result = { platform: process.platform, arch: process.arch, checks: [] }
let browser
let page
let step = "initializing"
const launchEnvironment = {
  ...process.env,
  PIGCLAUDE_USER_DATA: userData,
  PIGCLAUDE_RUST_BASE_URL: fixture.origin,
  PIGCLAUDE_AUTH_ORIGIN: fixture.origin,
  PIGCLAUDE_UPDATE_CHECK: "0",
}
const windows = (command, input = {}) =>
  run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...launchEnvironment, ...input },
    timeout: 120_000,
  })

const pass = (value) => {
  result.checks.push(value)
  console.log("PASS", value)
}

async function pid() {
  if (win) {
    const { stdout } = await windows(
      "Get-CimInstance Win32_Process -Filter \"Name='PigClaude.exe'\" | Where-Object { $_.ExecutablePath -eq $env:QA_INSTALL_EXE -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ProcessId }",
      { QA_INSTALL_EXE: executable },
    )
    const ids = stdout.match(/\d+/g) ?? []
    assert(ids.length <= 1, "more than one installed main process")
    return ids.length === 0 ? null : Number(ids[0])
  }
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,comm="])
  const pids = stdout.split("\n").flatMap((line) => {
    const fields = /^\s*(\d+)\s+(.+)$/.exec(line)
    return fields?.[2] === executable ? [Number(fields[1])] : []
  })
  assert(pids.length <= 1, "test bundle started more than one primary process")
  return pids[0] ?? null
}

async function freePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", resolve)
  })
  const { port } = probe.address()
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}

async function installArtifact() {
  if (win) {
    await windows(
      "$argsForInstaller = '/S /D=' + $env:QA_INSTALL_DESTINATION; $p = Start-Process -FilePath $env:QA_INSTALLER -ArgumentList $argsForInstaller -PassThru -Wait; exit $p.ExitCode",
      { QA_INSTALLER: installer, QA_INSTALL_DESTINATION: installed },
    )
    assert((await stat(executable)).isFile())
    const launched = await pid()
    if (launched) {
      await windows("Stop-Process -Id ([int]$env:QA_INSTALL_PID) -Force", {
        QA_INSTALL_PID: String(launched),
      })
      await expect.poll(pid, { timeout: 12_000 }).toBeNull()
    }
    return
  }
  await mkdir(mount, { recursive: true })
  await mkdir(installDir, { recursive: true })
  await run("/usr/bin/hdiutil", [
    "attach",
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mount,
    installer,
  ])
  try {
    await run("/usr/bin/ditto", [join(mount, "PigClaude.app"), installed])
  } finally {
    await run("/usr/bin/hdiutil", ["detach", mount])
  }
}

async function launch(callback) {
  const port = await freePort()
  const debug = ["--remote-debugging-port=" + port, "--remote-debugging-address=127.0.0.1"]
  if (win) {
    const app = spawn(executable, debug, {
      env: launchEnvironment,
      stdio: "ignore",
      windowsHide: true,
    })
    app.unref()
  } else
    await run("/usr/bin/open", [
      "-g",
      "-n",
      "-a",
      installed,
      "--env",
      "PIGCLAUDE_USER_DATA=" + userData,
      "--env",
      "PIGCLAUDE_RUST_BASE_URL=" + fixture.origin,
      "--env",
      "PIGCLAUDE_AUTH_ORIGIN=" + fixture.origin,
      "--env",
      "PIGCLAUDE_UPDATE_CHECK=0",
      ...(callback ? [callback] : []),
      "--args",
      ...debug,
    ])
  const origin = "http://127.0.0.1:" + port
  await expect
    .poll(
      async () => {
        const response = await fetch(origin + "/json/version").catch(() => null)
        return response?.ok ?? false
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  browser = await chromium.connectOverCDP(origin)
  const context = browser.contexts()[0]
  page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 20_000 }))
  page.setDefaultTimeout(15_000)
  await page.waitForFunction(() => !!window.pigclaude?.membership)
  assert(await pid(), "process is not running the installed bundle")
  return page
}

async function dispatch(url) {
  if (win)
    await windows("Start-Process -FilePath $env:QA_INSTALL_URI", { QA_INSTALL_URI: String(url) })
  else await run("/usr/bin/open", ["-g", "-a", installed, String(url)])
}

async function membershipState() {
  return page.evaluate(async () => (await window.pigclaude.membership.inspect()).state)
}

async function close() {
  if (page && !page.isClosed()) {
    await page
      .evaluate(async () => {
        await window.pigclaude.window.setCloseToTray(false)
        await window.pigclaude.window.control("close")
      })
      .catch(() => {})
  }
  await expect.poll(pid, { timeout: 15_000 }).toBeNull()
  await browser?.close().catch(() => {})
  page = undefined
  browser = undefined
}

try {
  step = "install packaged artifact"
  await installArtifact()
  if (!win) {
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", installed])
    const info = (key) =>
      run("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :" + key,
        join(installed, "Contents/Info.plist"),
      ]).then((value) => value.stdout.trim())
    assert.equal(await info("CFBundleIdentifier"), "com.pigclaude.desktop")
    assert.equal(await info("CFBundleShortVersionString"), "0.0.1")
    assert.equal(await info("CFBundleURLTypes:0:CFBundleURLSchemes:0"), "pigclaude")
  } else {
    await launch()
    await expect(page.getByRole("heading", { name: "欢迎使用 PigClaude" })).toBeVisible()
    await close()
    const registration = await windows(
      "Get-ItemPropertyValue -Path 'HKCU:\\Software\\Classes\\pigclaude\\shell\\open\\command' -Name '(default)'",
    )
    assert(registration.stdout.toLowerCase().includes(executable.toLowerCase()))
  }
  result.os = win
    ? "Windows Server 2022"
    : (await run("/usr/bin/sw_vers", ["-productVersion"])).stdout.trim()
  result.desktop = (await run("git", ["rev-parse", "HEAD"])).stdout.trim()
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(installer)) hash.update(chunk)
  result.sha256 = hash.digest("hex")
  pass("real installer and OS protocol registration verified")

  step = "OS cold launch"
  if (win) {
    await dispatch(coldCallback)
    await expect.poll(pid, { timeout: 30_000 }).not.toBeNull()
    const coldPid = await pid()
    const coldArgs = { QA_INSTALL_PID: String(coldPid) }
    await expect
      .poll(
        async () =>
          (
            await windows("(Get-Process -Id ([int]$env:QA_INSTALL_PID)).MainWindowHandle", coldArgs)
          ).stdout.trim(),
        { timeout: 30_000 },
      )
      .toMatch(/^[1-9][0-9]*$/)
    await windows(
      "(Get-Process -Id ([int]$env:QA_INSTALL_PID)).CloseMainWindow() | Out-Null",
      coldArgs,
    )
    await expect.poll(pid, { timeout: 20_000 }).toBeNull()
  }
  await launch(win ? undefined : coldCallback)
  await expect(page.getByRole("heading", { name: "欢迎使用 PigClaude" })).toBeVisible()
  await expect.poll(membershipState).toBe("signed_out")
  assert.equal(fixture.state().exchanges, 0)
  const app = await page.evaluate(() => window.pigclaude.appInfo())
  assert.equal(app.appVersion, "0.0.1")
  assert.equal(app.userDataPath, userData)
  pass("OS cold start with an unknown callback leaves the isolated profile signed out")

  step = "login opens system browser and gets actual private URL callback"
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page.getByRole("button", { name: "复制链接", exact: true })).toBeEnabled()
  await expect.poll(() => fixture.state().browserVisits, { timeout: 30_000 }).toBeGreaterThan(0)
  const approved = fixture.nativeCallback()
  const wrong = new URL(approved)
  wrong.searchParams.set("state", "invalid-state-fixture")
  await dispatch(wrong)
  // 其他事务的回调被主进程丢弃，正常界面继续等待当前授权。
  await expect(page.getByRole("button", { name: "复制链接", exact: true })).toBeEnabled()
  assert.equal(fixture.state().exchanges, 0)
  await dispatch(approved)
  await page.getByRole("button", { name: "稍后再说", exact: true }).click()
  await expect(page.locator("[data-main-window][data-screen=chat]")).toBeVisible()
  await expect.poll(membershipState).toBe("active")
  assert.equal(fixture.state().exchanges, 1)
  const identity = fixture.state().identities[0]
  assert(identity?.id && identity.platform && identity.appVersion === "0.0.1")
  result.browserVisits = fixture.state().browserVisits
  result.device = { platform: identity.platform, appVersion: identity.appVersion, recorded: true }
  pass("default browser request received and OS URL callback accepts only the matching state")

  step = "encrypted session across app restart and reinstall"
  const media = JSON.parse(await readFile(join(userData, "authorization-secrets.json"), "utf8"))
  const entries = Object.entries(media).filter(([key]) => key.startsWith("membership:"))
  assert(entries.length > 0)
  for (const [, value] of entries) {
    assert(typeof value === "string" && Buffer.from(value, "base64").toString("base64") === value)
  }
  await close()
  await launch()
  await expect(page.locator("[data-main-window][data-screen=chat]")).toBeVisible()
  await expect.poll(membershipState).toBe("active")
  assert.equal(fixture.state().exchanges, 1)
  pass("encrypted authorization retained after a complete process exit and restart")

  await close()
  if (win) {
    const names = await readdir(installed)
    const uninstall = names.find((file) => /^Uninstall.*\.exe$/i.test(file))
    assert(uninstall)
    await windows(
      "$p = Start-Process -FilePath $env:QA_UNINSTALLER -ArgumentList '/S' -PassThru -Wait; exit $p.ExitCode",
      { QA_UNINSTALLER: join(installed, uninstall) },
    )
    assert.equal(
      await stat(executable).then(
        () => true,
        () => false,
      ),
      false,
    )
  } else await rm(installed, { recursive: true, force: true })
  await installArtifact()
  await launch()
  await expect(page.locator("[data-main-window][data-screen=chat]")).toBeVisible()
  await expect.poll(membershipState).toBe("active")
  assert.equal(fixture.state().exchanges, 1)
  pass("reinstall from the same installer retains encrypted authorization in the isolated profile")

  step = "membership boundary and stable OS identity"
  await page.evaluate(() => window.pigclaude.membership.signOut())
  await expect(page.getByRole("heading", { name: "欢迎使用 PigClaude" })).toBeVisible()
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page.getByRole("button", { name: "复制链接", exact: true })).toBeEnabled()
  const laterIdentity = fixture.state().identities.at(-1)
  assert.equal(laterIdentity.id, identity.id)
  result.device.stable = true
  await dispatch(fixture.nativeCallback())
  const skip = page.getByRole("button", { name: "稍后再说", exact: true })
  if (await skip.isVisible()) await skip.click()
  await expect.poll(membershipState).toBe("active")
  fixture.setMembership("expired")
  await page.evaluate(() => window.pigclaude.membership.inspect())
  await expect(page.getByRole("heading", { name: "会员已到期" })).toBeVisible()
  pass("new authorization uses same device identity and expiry closes the desktop shell")
  await close()
  await writeFile(join(root, "verified.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify(result))
} catch (error) {
  const safe = String(error.stack ?? error).replace(
    /(?:pigclaude:\/\/|https?:\/\/)[^\s"')]+/g,
    "[URL]",
  )
  console.error("FAIL", step, safe.slice(0, 2400))
  process.exitCode = 1
} finally {
  const running = await pid().catch(() => null)
  if (running) process.kill(running, "SIGKILL")
  await browser?.close().catch(() => {})
  await fixture.close()
}
