// 使用 test.11 和 test.13 的原始 NSIS 验证按用户覆盖安装、会员恢复、协议和自启。
import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, createReadStream, existsSync, openSync } from "node:fs"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { basename, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"
import { chromium, expect } from "@playwright/test"
import { startMembershipFixture } from "./installed-membership-fixture.mjs"

const run = promisify(execFile)
const win = process.platform === "win32"
const installer = await realpath(process.env.QA_INSTALLER)
const baselineInstaller = await realpath(process.env.QA_BASELINE_INSTALLER)
const root = process.env.QA_ROOT
const evidence = process.env.QA_OUTPUT
await mkdir(root, { recursive: true })
await mkdir(evidence, { recursive: true })
const installed = win
  ? join(process.env.LOCALAPPDATA, "Programs", "PigClaude")
  : "/Applications/PigClaude.app"
const executable = win
  ? join(installed, "PigClaude.exe")
  : join(installed, "Contents", "MacOS", "PigClaude")
const userData = join(root, "profile")
const logPath = join(root, "programs.log")
const log = openSync(logPath, "a")
const fixture = await startMembershipFixture(true)
const coldUri = "pigclaude://authorize/callback?code=cold-fixture&state=cold-fixture"
const runtime = {
  PIGCLAUDE_USER_DATA: userData,
  PIGCLAUDE_RUST_BASE_URL: fixture.origin,
  PIGCLAUDE_AUTH_ORIGIN: fixture.origin,
  PIGCLAUDE_UPDATE_CHECK: "0",
}
const environment = { ...process.env, ...runtime }
const macEnv = Object.entries(runtime).flatMap(([key, value]) => ["--env", key + "=" + value])
const result = {
  release: "desktop-v0.0.1-test.13",
  buildCommit: process.env.QA_BUILD_SHA,
  artifactRun: Number(process.env.QA_BUILD_RUN),
  installer: basename(installer),
  baselineRelease: "desktop-v0.0.1-test.11",
  offlineReplacement: true,
  platform: process.platform,
  arch: process.arch,
  checks: [],
}
let step = ""
let appBrowser
let chrome
let chromeChild

const begin = (value) => {
  step = value
  console.log("CHECK", value)
}
const pass = (value) => {
  result.checks.push(value)
  console.log("PASS", value)
}
const safe = (value) =>
  String(value).replace(/(?:pigclaude:\/\/|https?:\/\/|wss?:\/\/)[^\s"')]+/g, "[URL]")

const windows = (command, extra = {}, timeout = 35_000) =>
  run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...environment, ...extra },
    timeout,
  })

function start(file, args) {
  const child = spawn(file, args, { env: environment, stdio: ["ignore", log, log] })
  child.unref()
  return child
}

async function pid() {
  if (win) {
    const { stdout } = await windows(
      "Get-CimInstance Win32_Process -Filter \"Name='PigClaude.exe'\" | Where-Object { $_.ExecutablePath -eq $env:QA_EXE -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ProcessId }",
      { QA_EXE: executable },
    )
    const ids = stdout.match(/\d+/g) ?? []
    assert(ids.length <= 1, "more than one installed main process")
    return ids.length ? Number(ids[0]) : null
  }
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,comm="], { timeout: 10_000 })
  const ids = stdout.split("\n").flatMap((line) => {
    const values = /^\s*(\d+)\s+(.+)$/.exec(line)
    return values?.[2] === executable ? [Number(values[1])] : []
  })
  assert(ids.length <= 1, "more than one installed main process")
  return ids[0] ?? null
}

async function windowsHandle(processId) {
  const { stdout } = await windows(
    "(Get-Process -Id ([int]$env:QA_APP_PID) -ErrorAction SilentlyContinue).MainWindowHandle",
    { QA_APP_PID: String(processId) },
  )
  return Number(stdout.trim())
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function debugArgs(port) {
  return ["--remote-debugging-port=" + port, "--remote-debugging-address=127.0.0.1"]
}

async function connect(port) {
  const origin = "http://127.0.0.1:" + port
  await expect
    .poll(
      async () => {
        const response = await fetch(origin + "/json/version", {
          signal: AbortSignal.timeout(1000),
        }).catch(() => null)
        return response?.ok ?? false
      },
      { timeout: 40_000 },
    )
    .toBe(true)
  return chromium.connectOverCDP(origin)
}

async function connectApp(port) {
  appBrowser = await connect(port)
  const context = appBrowser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 25_000 }))
  page.setDefaultTimeout(20_000)
  await page.waitForFunction(() => !!window.pigclaude?.membership)
  return page
}

async function install(packagePath = installer) {
  if (win) {
    await windows(
      "$ErrorActionPreference='Stop'; $p = Start-Process -FilePath $env:QA_INSTALLER -ArgumentList ('/S /D=' + $env:QA_INSTALL_PATH) -Wait -PassThru; exit $p.ExitCode",
      { QA_INSTALLER: packagePath, QA_INSTALL_PATH: installed },
      150_000,
    )
    assert(existsSync(executable), "NSIS did not install the expected executable")
    const installedPid = await pid()
    result.installerOpenedApp = installedPid !== null
    if (installedPid) {
      await expect.poll(() => windowsHandle(installedPid), { timeout: 30_000 }).toBeGreaterThan(0)
      await windows("(Get-Process -Id ([int]$env:QA_APP_PID)).CloseMainWindow() | Out-Null", {
        QA_APP_PID: String(installedPid),
      })
      await expect.poll(pid, { timeout: 20_000 }).toBeNull()
    }
    return
  }
  const mount = join(root, "dmg")
  await mkdir(mount, { recursive: true })
  await run(
    "/usr/bin/hdiutil",
    ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, packagePath],
    {
      timeout: 100_000,
    },
  )
  try {
    await run("/usr/bin/sudo", ["-n", "/usr/bin/ditto", join(mount, "PigClaude.app"), installed], {
      timeout: 120_000,
    })
  } finally {
    await run("/usr/bin/hdiutil", ["detach", mount], { timeout: 40_000 })
  }
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", installed], { timeout: 35_000 })
  const read = (key) =>
    run("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :" + key,
      join(installed, "Contents", "Info.plist"),
    ]).then(({ stdout }) => stdout.trim())
  assert.equal(await read("CFBundleIdentifier"), "com.pigclaude.desktop")
  assert.equal(await read("CFBundleURLTypes:0:CFBundleURLSchemes:0"), "pigclaude")
}

const signIn = (page) => page.getByRole("button", { name: /^(登录|Sign in|Log in)$/i })
const membership = (page) =>
  page.evaluate(async () => (await window.pigclaude.membership.inspect()).state)

async function sha256(path) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

async function loginItem() {
  const { stdout } = await windows(
    "Get-ItemPropertyValue -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'com.pigclaude.desktop.autostart'",
  )
  assert(stdout.toLowerCase().includes(executable.toLowerCase()))
  assert(stdout.includes("--pigclaude-autostart"))
  return stdout.trim()
}

async function closeApp(page) {
  await page
    .evaluate(async () => {
      await window.pigclaude.window.setCloseToTray(false)
      await window.pigclaude.window.control("close")
    })
    .catch(() => {})
  await expect.poll(pid, { timeout: 25_000 }).toBeNull()
  await appBrowser?.close().catch(() => {})
  appBrowser = undefined
}

async function chromeFromFixtureUrl() {
  const chromePath = win
    ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
        .filter(Boolean)
        .map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe"))
        .find(existsSync)
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  assert(chromePath && existsSync(chromePath), "the runner's Google Chrome is unavailable")
  const profileRoot = join(root, "chrome")
  const preferences = join(profileRoot, "Default")
  await mkdir(preferences, { recursive: true })
  // 在独立的浏览器配置里只预先确认本次回环页面的 PigClaude 协议提示。
  await writeFile(
    join(preferences, "Preferences"),
    JSON.stringify({
      protocol_handler: {
        allowed_origin_protocol_pairs: { [fixture.origin]: { pigclaude: true } },
      },
    }),
  )
  const port = await freePort()
  chromeChild = start(chromePath, [
    ...debugArgs(port),
    "--user-data-dir=" + profileRoot,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "about:blank",
  ])
  chrome = await connect(port)
  const context = chrome.contexts()[0]
  const page = context.pages()[0] ?? (await context.newPage())
  const authUrl = new URL(fixture.authorizationUrl())
  assert.equal(authUrl.origin, fixture.origin)
  await page.goto(authUrl.href, { waitUntil: "domcontentloaded", timeout: 20_000 })
  return page
}

try {
  begin("SHA-256 and clean install baseline")
  assert(win)
  result.sha256 = await sha256(installer)
  assert.equal(result.sha256, process.env.QA_EXPECTED_SHA)
  result.baselineSha256 = await sha256(baselineInstaller)
  assert.equal(result.baselineSha256, process.env.QA_BASELINE_SHA)
  assert(
    !existsSync(installed) && !existsSync(userData),
    "test installation/profile already exists",
  )
  if (win) {
    assert.equal(process.arch, "x64")
    result.os =
      "Windows Server 2022 " +
      (await windows("[Environment]::OSVersion.Version.ToString()")).stdout.trim()
    const { stdout } = await windows(
      "Test-Path -LiteralPath 'Registry::HKEY_CLASSES_ROOT\\pigclaude'",
    )
    assert.equal(stdout.trim(), "False", "Windows already has a pigclaude protocol handler")
  } else {
    assert.equal(process.arch, "arm64")
    result.os = "macOS " + (await run("/usr/bin/sw_vers", ["-productVersion"])).stdout.trim()
    const opened = await run("/usr/bin/open", ["-g", "-u", coldUri], { timeout: 10_000 }).then(
      () => true,
      () => false,
    )
    assert(!opened, "macOS already has a pigclaude protocol handler")
  }
  pass("installer SHA-256 matches test.13 and the runner has no app or protocol registration")

  begin("real install, initial startup, and native protocol association")
  await install(baselineInstaller)
  result.installMethod = win ? "per-user NSIS /S" : "mounted DMG copied into /Applications"
  const originalCode = await sha256(join(installed, "resources", "app.asar"))
  const firstPort = await freePort()
  if (win) start(executable, debugArgs(firstPort))
  else
    await run("/usr/bin/open", [
      "-g",
      "-a",
      installed,
      ...macEnv,
      "--args",
      ...debugArgs(firstPort),
    ])
  const app = await connectApp(firstPort)
  await expect(signIn(app)).toBeVisible()
  await expect.poll(() => membership(app)).toBe("signed_out")
  const firstPid = await pid()
  assert(firstPid, "the first app did not start from the installed path")
  const info = await app.evaluate(() => window.pigclaude.appInfo())
  assert.equal(info.appVersion, "0.0.1")
  assert.equal(await realpath(info.userDataPath), await realpath(userData))
  if (win) {
    const { stdout } = await windows(
      "Get-ItemPropertyValue -Path 'HKCU:\\Software\\Classes\\pigclaude\\shell\\open\\command' -Name '(default)'",
    )
    assert(stdout.toLowerCase().includes(executable.toLowerCase()))
    assert(stdout.includes("%1"))
  }
  await app.screenshot({ path: join(evidence, "first-launch.png") })
  pass("actual installer and first signed-out window at the installed location verified")

  begin("real Chrome follows the OS protocol from the authorization page")
  await signIn(app).click()
  await expect(app.getByRole("button", { name: /^(复制链接|Copy link)$/i })).toBeEnabled()
  const page = await chromeFromFixtureUrl()
  assert(fixture.state().browserVisits > 0)
  result.chrome = chrome.version()
  await page.getByRole("link", { name: "Send wrong state" }).click()
  await delay(800)
  assert.equal(fixture.state().exchangeAttempts, 0)
  await page.getByRole("link", { name: "Approve device" }).click()
  await expect.poll(() => membership(app), { timeout: 25_000 }).toBe("active")
  await page.getByRole("link", { name: "Approve device" }).click()
  await delay(800)
  assert.equal(fixture.state().exchangeAttempts, 1)
  assert.equal(fixture.state().exchanges, 1)
  assert.equal(await pid(), firstPid)
  result.exchangeAttempts = fixture.state().exchangeAttempts
  const skip = app.getByRole("button", { name: /^(稍后再说|Maybe later|Skip for now)$/i })
  if (await skip.isVisible()) await skip.click()
  await app.screenshot({ path: join(evidence, "after-chrome-authorization.png") })
  pass(
    "a Chrome click reached the running installed app and the authorization exchanged exactly once",
  )

  begin("keep membership, preferences and login item across an in-place replacement")
  const before = await app.evaluate(async () => {
    const { membership, startupPreferences, updates, window } = globalThis.pigclaude
    const facts = await membership.inspect()
    await window.setCloseToTray(false)
    await updates.setAutoCheck(false)
    await startupPreferences.set("openAtLogin", true)
    return {
      state: facts.state,
      userId: facts.account?.userId,
      bindingEpoch: facts.bindingEpoch,
      startAtLogin: (await startupPreferences.get()).openAtLogin,
      autoCheck: (await updates.state()).autoCheck,
      closeToTray: await window.getCloseToTray(),
    }
  })
  assert.equal(before.state, "active")
  assert(before.userId && before.bindingEpoch && before.startAtLogin)
  assert.equal(before.autoCheck, false)
  assert.equal(before.closeToTray, false)
  const startupEntry = await loginItem()
  await closeApp(app)
  await install()
  assert.notEqual(await sha256(join(installed, "resources", "app.asar")), originalCode)
  const port = await freePort()
  start(executable, debugArgs(port))
  const updated = await connectApp(port)
  await expect.poll(() => membership(updated), { timeout: 25_000 }).toBe("active")
  const after = await updated.evaluate(async () => {
    const { membership, startupPreferences, updates, window } = globalThis.pigclaude
    const facts = await membership.inspect()
    return {
      state: facts.state,
      userId: facts.account?.userId,
      bindingEpoch: facts.bindingEpoch,
      startAtLogin: (await startupPreferences.get()).openAtLogin,
      autoCheck: (await updates.state()).autoCheck,
      closeToTray: await window.getCloseToTray(),
    }
  })
  assert.deepEqual(after, before)
  assert.equal(await loginItem(), startupEntry)
  assert.equal(fixture.state().exchangeAttempts, 1)
  result.installReplacedCode = true
  result.kept = { membership: true, bindingEpoch: true, loginItem: true, preferences: true }
  const updatedPid = await pid()
  assert(updatedPid && updatedPid !== firstPid)
  pass(
    "installed code changed and the original membership, startup registration and preferences were restored",
  )

  begin("quit, then cold launch via the default OS handler")
  await closeApp(updated)
  assert.equal(await pid(), null)
  if (win) {
    await windows("Start-Process -FilePath $env:QA_CALLBACK", { QA_CALLBACK: coldUri })
    await expect.poll(pid, { timeout: 35_000 }).not.toBeNull()
    const launched = await pid()
    assert(launched && launched !== updatedPid)
    await expect.poll(() => windowsHandle(launched), { timeout: 30_000 }).toBeGreaterThan(0)
  } else {
    const port = await freePort()
    // 让 LaunchServices 从 URL 自行选择应用并携带用于观察窗口的回环参数。
    await run("/usr/bin/open", ["-g", ...macEnv, "-u", coldUri, "--args", ...debugArgs(port)])
    await expect.poll(pid, { timeout: 35_000 }).not.toBeNull()
    const launched = await pid()
    assert(launched && launched !== firstPid)
    const coldPage = await connectApp(port)
    await expect.poll(() => membership(coldPage), { timeout: 25_000 }).toBe("active")
    await coldPage.screenshot({ path: join(evidence, "cold-launch.png") })
  }
  assert.equal(fixture.state().exchangeAttempts, 1)
  result.coldStarted = true
  pass("the default OS URL handler cold-started the installed app after a complete exit")
} catch (error) {
  result.failure = { step, message: safe(error.stack ?? error).slice(0, 3200) }
  console.error(result.failure)
  process.exitCode = 1
} finally {
  await appBrowser?.close().catch(() => {})
  await chrome?.close().catch(() => {})
  if (chromeChild?.exitCode == null) chromeChild?.kill()
  const active = await pid().catch(() => null)
  if (active) {
    if (win)
      await windows(
        "Stop-Process -Id ([int]$env:QA_APP_PID) -Force -ErrorAction SilentlyContinue",
        {
          QA_APP_PID: String(active),
        },
      ).catch(() => {})
    else {
      try {
        process.kill(active, "SIGTERM")
      } catch (error) {
        if (error.code !== "ESRCH") throw error
      }
    }
  }
  await fixture.close()
  closeSync(log)
  const logs = safe((await readFile(logPath, "utf8")).slice(-20_000))
  await writeFile(join(evidence, "programs.log"), logs)
  if (result.failure) console.log(logs)
  await writeFile(join(evidence, "verified.json"), JSON.stringify(result, null, 2) + "\n")
  await new Promise((resolve) =>
    process.stdout.write(JSON.stringify(result, null, 2) + "\n", resolve),
  )
  process.exit(process.exitCode ?? 0)
}
