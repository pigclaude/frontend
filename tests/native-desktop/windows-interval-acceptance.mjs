// 在安装包运行目录发起真实定时任务，记录 Windows 墙钟和原生窗口状态。
import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { setTimeout as wait } from "node:timers/promises"
import { promisify } from "node:util"
import { chromium } from "@playwright/test"
import { startMembershipFixture } from "./windows-interval-fixture.mjs"

const executable = resolve(process.argv[2])
const resultPath = resolve(process.argv[3])
assert.equal(process.platform, "win32")
const run = promisify(execFile)
const profile = await mkdtemp(join(process.env.RUNNER_TEMP, "background-interval-profile-"))
const fixture = await startMembershipFixture(true)
const env = {
  ...process.env,
  PIGCLAUDE_USER_DATA: profile,
  PIGCLAUDE_AUTH_ORIGIN: fixture.origin,
  PIGCLAUDE_WEBSITE_ORIGIN: fixture.origin,
  PIGCLAUDE_RUST_BASE_URL: fixture.origin,
  PIGCLAUDE_UPDATE_CHECK: "0",
}
const child = spawn(executable, ["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"], {
  env, stdio: "ignore", windowsHide: true,
})
const result = { os: "Windows Server 2022 GitHub hosted", membership: "synthetic loopback" }
let browser
let launcher
let page
let task
let phase = "app bootstrap"
const save = () => writeFile(resultPath, JSON.stringify(result, null, 2) + "\n")
async function until(work, budget) {
  const limit = performance.now() + budget
  while (performance.now() < limit) {
    assert.equal(child.exitCode, null)
    const done = await work()
    if (done) return done
    await wait(500)
  }
  throw Error("deadline at " + phase)
}
async function activeMainWindow() {
  const expression = "([int64] (Get-Process -Id " + child.pid + ").MainWindowHandle)"
  const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", expression], {
    windowsHide: true, timeout: 16000,
  })
  return output.stdout.trim() !== "0"
}

try {
  const [port] = await until(async () => {
    const raw = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "")
    const bits = raw.trim().split(/\r?\n/)
    return bits.length === 2 && bits
  }, 80000)
  const cdp = "http://127.0.0.1:" + port
  await until(async () => (await fetch(cdp + "/json/version", {
    signal: AbortSignal.timeout(3500),
  }).catch(() => null))?.ok, 60000)
  browser = await chromium.connectOverCDP(cdp, { timeout: 85000 })
  const context = browser.contexts()[0]
  page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 40000 })
  page.setDefaultTimeout(45000)

  phase = "authorized synthetic desktop profile"
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await until(() => fixture.state().identities.length > 0, 65000)
  result.appVersion = fixture.state().identities[0].appVersion
  assert.equal(result.appVersion, "0.0.1")
  const callback = fixture.nativeCallback()
  if (callback.protocol === "http:") {
    await fetch(callback, { signal: AbortSignal.timeout(16000) })
  } else {
    launcher = spawn(executable, [callback.href], { env, windowsHide: true, stdio: "ignore" })
    launcher.on("error", () => {})
  }
  await until(() => fixture.state().exchanges === 1, 75000)
  await page.getByRole("button", { name: "稍后再说" }).click()

  phase = "schedule and hide"
  await until(activeMainWindow, 15000)
  await page.evaluate(() => window.pigclaude.window.setCloseToTray(true))
  const anchor = Date.now()
  task = await page.evaluate(({ projectPath, anchor }) => window.pigclaude.scheduledTasks.create({
    projectPath, prompt: "Windows interval verification with no project",
    rule: { kind: "everyMinutes", every: 15, anchor: new Date(anchor).toISOString() },
    endsAt: null, enabled: true, model: null, permissionMode: "default", accountId: null,
  }), { projectPath: join(profile, "missing-scheduled-project"), anchor })
  assert.equal(Date.parse(task.nextRunAt), anchor + 900000)
  await page.evaluate(() => window.pigclaude.window.control("close"))
  await until(async () => !(await activeMainWindow()), 12000)
  const hiddenAt = Date.now()
  const hiddenTimer = performance.now()
  result.arm = {
    intervalMinutes: 15, hiddenAt: new Date(hiddenAt).toISOString(), nextRunAt: task.nextRunAt,
  }
  assert.ok(Date.parse(task.nextRunAt) - hiddenAt >= 875000)
  await save()
  console.log("WINDOWS_INTERVAL_ARMED", task.nextRunAt)

  phase = "actual fifteen minute interval"
  let inspections = 0
  let outcome
  const deadline = Date.parse(task.nextRunAt) + 85000
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null)
    assert.equal(await activeMainWindow(), false)
    inspections += 1
    const history = await page.evaluate(id => window.pigclaude.scheduledTasks.runs(id, 0, 20), task.id)
    if (history.runs[0]?.status === "skipped") {
      assert.equal(history.total, 1)
      outcome = history.runs[0]
      break
    }
    await wait(19000)
  }
  assert.ok(outcome)
  assert.equal(outcome.reason, "PROJECT_UNAVAILABLE")
  assert.equal(outcome.source, "schedule")
  assert.equal(outcome.scheduledAt, task.nextRunAt)
  result.backgroundElapsedMs = Math.round(performance.now() - hiddenTimer)
  result.hiddenNativeWindowSamples = inspections
  result.run = {
    reason: outcome.reason, source: outcome.source, status: outcome.status,
    scheduledAt: outcome.scheduledAt, triggeredAt: outcome.triggeredAt,
  }
  result.passed = true
  await save()
  console.log("WINDOWS_INTERVAL_VERIFIED", outcome.triggeredAt)
} catch (e) {
  result.phase = phase
  result.error = String(e instanceof Error ? e.message : e).split("\n")[0]
    .replace(/[a-z]+:\/\/\S+/gi, "[local endpoint]").slice(0, 220)
  result.passed = false
  await save()
  console.error(result.error)
  process.exitCode = 1
} finally {
  if (page && task) await page.evaluate(id => window.pigclaude.scheduledTasks.remove(id), task.id).catch(() => {})
  await Promise.race([browser?.close().catch(() => {}), wait(4000)])
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
  if (launcher?.exitCode === null && launcher.signalCode === null) launcher.kill("SIGTERM")
  await Promise.race([fixture.close(), wait(4500)])
}
