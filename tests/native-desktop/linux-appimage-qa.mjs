// 从指定发布制品运行 AppImage，并使用隔离的 XDG 目录验收桌面授权回跳。
import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, closeSync, openSync } from "node:fs"
import { mkdir, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { basename, dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"
import { chromium, expect } from "@playwright/test"
import { startMembershipFixture } from "./installed-membership-fixture.mjs"

const run = promisify(execFile)
const root = process.env.QA_ROOT
const evidence = process.env.QA_OUTPUT
const image = await realpath(process.env.QA_IMAGE)
const applications = join(process.env.XDG_DATA_HOME, "applications")
const userData = join(root, "profile")
const logPath = join(root, "programs.log")
const log = openSync(logPath, "a")
const scheme = "x-scheme-handler/pigclaude"
const cold = "pigclaude://authorize/callback?code=cold-fixture&state=cold-fixture"
const result = {
  source: "7dc803a2f0c03d0fcb464c9bf06cb2bc9447d1e3",
  workflowRun: 43993199194,
  appImage: basename(image),
  os: (await readFile("/etc/os-release", "utf8")).match(/^PRETTY_NAME="(.+)"$/m)?.[1],
  arch: process.arch,
  appArmorUsernsRestriction: (
    await readFile("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8")
  ).trim(),
  checks: [],
}
const fixture = await startMembershipFixture(true)
const environment = {
  ...process.env,
  PIGCLAUDE_USER_DATA: userData,
  PIGCLAUDE_RUST_BASE_URL: fixture.origin,
  PIGCLAUDE_AUTH_ORIGIN: fixture.origin,
  PIGCLAUDE_UPDATE_CHECK: "0",
}
const probe = createServer()
await new Promise((resolve, reject) => {
  probe.once("error", reject)
  probe.listen(0, "127.0.0.1", resolve)
})
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const debug = ["--remote-debugging-port=" + port, "--remote-debugging-address=127.0.0.1"]
let browser
let stage = "prepare desktop test"
let direct

const pass = (message) => {
  result.checks.push(message)
  console.log("PASS", message)
}
const safe = (message) =>
  String(message).replace(/(?:pigclaude:\/\/|https?:\/\/|wss?:\/\/)[^\s"')]+/g, "[URL]")

async function mainProcesses() {
  const pids = (await readdir("/proc")).filter((id) => /^\d+$/.test(id))
  return (
    await Promise.all(
      pids.map(async (pid) => {
        try {
          const exe = await readlink(join("/proc", pid, "exe"))
          if (basename(exe) !== "pigclaude") return null
          const argv = (await readFile(join("/proc", pid, "cmdline"), "utf8")).split("\0")
          if (argv.some((argument) => argument.startsWith("--type="))) return null
          const env = (await readFile(join("/proc", pid, "environ"), "utf8")).split("\0")
          return env.includes("APPIMAGE=" + image) ? { pid: Number(pid), exe, argv } : null
        } catch {
          return null
        }
      }),
    )
  ).filter(Boolean)
}

function start(command, args) {
  return spawn(command, args, { env: environment, stdio: ["ignore", log, log] })
}

async function openUri(url) {
  const process = start("gio", ["open", String(url)])
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.kill()
      reject(new Error("GIO URI dispatch timed out"))
    }, 10_000)
    process.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    process.once("exit", (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

async function connectWindow() {
  const origin = "http://127.0.0.1:" + port
  await expect
    .poll(
      async () => {
        if (direct?.exitCode != null || direct?.signalCode != null) {
          return "exited " + (direct.exitCode ?? direct.signalCode)
        }
        return (await fetch(origin + "/json/version").catch(() => null))?.ok ?? false
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  browser = await chromium.connectOverCDP(origin)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 20_000 }))
  page.setDefaultTimeout(15_000)
  await page.waitForFunction(() => !!window.pigclaude?.membership)
  return page
}

async function closeWindow(page) {
  await page
    .evaluate(async () => {
      await window.pigclaude.window.setCloseToTray(false)
      await window.pigclaude.window.control("close")
    })
    .catch(() => {})
  await expect.poll(async () => (await mainProcesses()).length, { timeout: 15_000 }).toBe(0)
  await browser?.close().catch(() => {})
  browser = undefined
  direct = undefined
}

const signIn = (page) => page.getByRole("button", { name: /^(登录|Sign in|Log in)$/i })
const copyLink = (page) => page.getByRole("button", { name: /^(复制链接|Copy link)$/i })
const membership = (page) =>
  page.evaluate(async () => (await window.pigclaude.membership.inspect()).state)

try {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(image)) hash.update(chunk)
  result.sha256 = hash.digest("hex")
  await mkdir(applications, { recursive: true })
  const browserDesktop = "pigclaude-qa-browser.desktop"
  await writeFile(
    join(applications, browserDesktop),
    [
      "[Desktop Entry]",
      "Version=1.0",
      "Type=Application",
      "Name=Chrome for AppImage QA",
      'Exec=/usr/bin/google-chrome --no-first-run --no-default-browser-check "--user-data-dir=' +
        join(root, "browser") +
        '" %U',
      "MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;",
      "",
    ].join("\n"),
  )
  await run("update-desktop-database", [applications])
  for (const mime of ["text/html", "x-scheme-handler/http", "x-scheme-handler/https"]) {
    await run("gio", ["mime", mime, browserDesktop])
  }

  stage = "direct AppImage launch via FUSE"
  direct = start(image, debug)
  const initial = await connectWindow()
  await expect(signIn(initial)).toBeVisible()
  const [started] = await mainProcesses()
  assert(started, "the actual AppImage process is missing")
  const bundle = dirname(started.exe)
  const mount = await run("findmnt", ["-n", "-o", "FSTYPE,OPTIONS", "--target", bundle])
  result.mount = mount.stdout.trim()
  assert.match(result.mount, /^fuse[.\s]/)
  result.application = await initial.evaluate(
    async () => (await window.pigclaude.appInfo()).appVersion,
  )
  assert.equal(result.application, "0.0.1")
  result.sandboxDisabledInArgs = started.argv.includes("--no-sandbox")
  const shippedDesktop = (await readdir(bundle)).filter((file) => file.endsWith(".desktop"))
  result.embeddedDesktop = await Promise.all(
    shippedDesktop.map(async (file) => ({
      file,
      settings: (await readFile(join(bundle, file), "utf8"))
        .split("\n")
        .filter((line) => /^(Exec|MimeType|TryExec)=/.test(line)),
    })),
  )
  await initial.screenshot({ path: join(evidence, "linux-appimage-start.png") })
  pass("downloaded AppImage mounted via FUSE and displayed the signed-out window")
  await closeWindow(initial)

  stage = "probe unconfigured desktop protocol handoff"
  const query = await run("xdg-mime", ["query", "default", scheme]).catch(() => ({ stdout: "" }))
  const handlers = await run("gio", ["mime", scheme], { env: { ...environment, LC_ALL: "C" } })
  const handler = query.stdout.trim()
  const defaultStatus = await openUri(cold)
  result.defaultProtocol = {
    handler: handler || null,
    gio: handlers.stdout.trim(),
    dispatchExit: defaultStatus,
  }
  let existingHandlerWorks = false
  if (defaultStatus === 0) {
    try {
      await expect
        .poll(async () => (await mainProcesses()).some((item) => item.argv.includes(cold)), {
          timeout: 15_000,
        })
        .toBe(true)
      existingHandlerWorks = true
      pass("pre-existing desktop association cold-launches the AppImage through GIO")
    } catch (error) {
      result.defaultProtocol.error = safe(error.message).slice(0, 900)
    } finally {
      for (const item of await mainProcesses()) process.kill(item.pid, "SIGTERM")
      await expect.poll(async () => (await mainProcesses()).length, { timeout: 15_000 }).toBe(0)
    }
  }
  result.defaultProtocol.delivered = existingHandlerWorks

  stage = "cold URI launch with isolated XDG integration"
  const desktopId = shippedDesktop[0] ?? "pigclaude.desktop"
  const desktopPath = join(applications, desktopId)
  const filename = '"' + image + '"'
  await writeFile(
    desktopPath,
    [
      "[Desktop Entry]",
      "Version=1.0",
      "Type=Application",
      "Name=PigClaude",
      "Exec=" + [filename, ...debug, "%U"].join(" "),
      "MimeType=" + scheme + ";",
      "",
    ].join("\n"),
  )
  await run("desktop-file-validate", [desktopPath])
  await run("update-desktop-database", [applications])
  await run("gio", ["mime", scheme, desktopId])
  const associated = await run("xdg-mime", ["query", "default", scheme])
  assert.equal(associated.stdout.trim(), desktopId)
  assert.equal(await openUri(cold), 0, "GIO did not dispatch the cold callback")
  const page = await connectWindow()
  const [coldProcess] = await mainProcesses()
  assert(coldProcess?.argv.includes(cold), "cold callback did not arrive in the AppImage process")
  await expect(signIn(page)).toBeVisible()
  await expect.poll(() => membership(page)).toBe("signed_out")
  assert.equal(fixture.state().exchangeAttempts, 0)
  pass("registered AppImage cold-started from GIO and ignored an unrelated callback")

  stage = "system browser and warm callbacks"
  await signIn(page).click()
  await expect(copyLink(page)).toBeEnabled()
  await expect.poll(() => fixture.state().browserVisits, { timeout: 30_000 }).toBeGreaterThan(0)
  const approved = fixture.nativeCallback()
  const wrong = new URL(approved)
  wrong.searchParams.set("state", "invalid-state-fixture")
  assert.equal(await openUri(wrong), 0)
  await delay(750)
  await expect(copyLink(page)).toBeEnabled()
  assert.equal(fixture.state().exchangeAttempts, 0)
  assert.equal(await openUri(approved), 0)
  await expect.poll(() => membership(page), { timeout: 15_000 }).toBe("active")
  const skip = page.getByRole("button", { name: /^(稍后再说|Maybe later|Skip for now)$/i })
  if (await skip.isVisible()) await skip.click()
  assert.equal(await openUri(approved), 0)
  await delay(750)
  await expect
    .poll(async () => (await mainProcesses()).map((item) => item.pid))
    .toEqual([coldProcess.pid])
  assert.equal(fixture.state().exchanges, 1)
  assert.equal(fixture.state().exchangeAttempts, 1)
  result.browserVisits = fixture.state().browserVisits
  result.exchangeAttempts = fixture.state().exchangeAttempts
  await page.screenshot({ path: join(evidence, "linux-appimage-authorized.png") })
  pass("default browser opened; valid callback exchanged once in the original AppImage instance")
  await closeWindow(page)
} catch (error) {
  result.failure = { stage, message: safe(error.stack ?? error).slice(0, 2100) }
  console.error(result.failure)
  process.exitCode = 1
} finally {
  for (const item of await mainProcesses()) process.kill(item.pid, "SIGTERM")
  if (direct?.pid && direct.exitCode == null && direct.signalCode == null) direct.kill("SIGTERM")
  await browser?.close().catch(() => {})
  await fixture.close()
  closeSync(log)
  const raw = (await readFile(logPath, "utf8")).slice(-12_000)
  const logs = safe(raw)
  await writeFile(join(evidence, "appimage.log"), logs)
  if (result.failure || result.defaultProtocol?.dispatchExit !== 0) console.log(logs)
  await writeFile(join(evidence, "verified.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify(result, null, 2))
}
