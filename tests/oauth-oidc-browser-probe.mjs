// 负责独立真实Playwright空白headless探针，只在本轮私有profile内核对owner信号和环境边界。
import childProcess from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { createOAuthLifecycle } from "../scripts/oauth-oidc-process-lifecycle.mjs"
import { startOwnedOAuthBrowser } from "../scripts/oauth-oidc-browser-owner.mjs"
const file = fileURLToPath(import.meta.url)
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === "ESRCH") return false
    if (error.code === "EPERM") return true
    throw error
  }
}
async function until(check, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await pause(25)
  }
  throw new Error("OWNED_BROWSER_PROBE_TIMEOUT")
}
if (process.argv[2] === "--owner") {
  const owner = createOAuthLifecycle()
  let connected
  let browserReady = false
  process.once("SIGINT", () =>
    process.send({ phase: "owner-signal", beforeBrowserReady: !browserReady }),
  )
  const register = owner.registerBrowserProcess
  owner.registerBrowserProcess = (child) => {
    register(child)
    const profileArg = child.spawnargs.find((arg) => arg.startsWith("--user-data-dir="))
    const profile = profileArg?.slice("--user-data-dir=".length)
    const pgid = Number(
      childProcess
        .execFileSync("ps", ["-p", String(child.pid), "-o", "pgid="], { encoding: "utf8" })
        .trim(),
    )
    const envText = childProcess.execFileSync(
      "ps",
      ["eww", "-p", String(child.pid), "-o", "command="],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    )
    process.send({
      phase: "browser-registered",
      pid: child.pid,
      pgid,
      independentGroup: pgid === child.pid,
      profileOwned: !!profile && resolve(profile).startsWith(resolve(process.env.TMPDIR) + "/"),
      envVerified:
        envText.includes("TMPDIR=" + process.env.TMPDIR) &&
        !envText.includes("OWNED_ENV_SECRET_SENTINEL") &&
        !envText.includes("DATABASE_URL=") &&
        !envText.includes("REDIS_URL="),
    })
    return child
  }
  try {
    for (const role of ["web", "fixture"]) {
      const code =
        'process.on("SIGTERM",()=>process.exit(0));process.stdin.resume();process.stdin.on("end",()=>process.exit(0));process.send({ready:true});setInterval(()=>{},1000)'
      const child = owner.spawn(
        process.execPath,
        ["-e", code],
        {
          stdio: ["pipe", "ignore", "ignore", "ipc"],
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
        },
        role,
      )
      await new Promise((done) => child.once("message", done))
      process.send({ phase: "fixture-owned", role, pid: child.pid })
    }
    const browser = await startOwnedOAuthBrowser(owner)
    browserReady = true
    const { chromium } = await import("@playwright/test")
    connected = await chromium.connect(browser.endpoint, { timeout: 10000 }).catch(() => {
      throw new Error("OWNED_BROWSER_PROBE_CONNECT_FAILED")
    })
    const page = await connected.newPage()
    await page.goto("about:blank").catch(() => {
      throw new Error("OWNED_BROWSER_PROBE_BLANK_FAILED")
    })
    process.send({ phase: "blank-ready" })
    await owner.pending(owner.cancellation)
  } catch {
    if (!owner.cancelledBySignal) {
      console.error("OWNED_BROWSER_PROBE_FAILED")
      process.exitCode = 1
    }
  } finally {
    try {
      await owner.shutdown()
      console.log("OWNED_BROWSER_PROBE_STOPPED")
    } catch {
      console.error("OWNED_BROWSER_PROBE_CLEANUP_FAILED")
      process.exitCode = 1
    }
    await connected?.close().catch(() => undefined)
    owner.dispose()
  }
} else {
  const unrelated = childProcess.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    detached: true,
    stdio: "ignore",
  })
  try {
    for (const stage of ["startup", "ready"]) {
      const dir = await mkdtemp(join(tmpdir(), "oauth-browser-profile-"))
      const messages = []
      let output = "",
        signalled = false
      const child = childProcess.fork(file, ["--owner"], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: dir,
          DATABASE_URL: "OWNED_ENV_SECRET_SENTINEL",
          REDIS_URL: "OWNED_ENV_SECRET_SENTINEL",
          OWNER_PRIVATE_TOKEN: "OWNED_ENV_SECRET_SENTINEL",
        },
      })
      const exited = new Promise((done) =>
        child.once("exit", (code, signal) => done({ code, signal })),
      )
      child.stdout.on("data", (chunk) => {
        output += chunk
      })
      child.stderr.on("data", (chunk) => {
        output += chunk
      })
      child.on("message", (message) => {
        messages.push(message)
        if (
          !signalled &&
          message.phase === (stage === "startup" ? "browser-registered" : "blank-ready")
        ) {
          signalled = true
          child.kill("SIGINT")
        }
      })
      try {
        await until(() => child.exitCode !== null || child.signalCode !== null, 40000)
        const result = await exited
        const owned = messages.filter((row) => row.pid).flatMap((row) => [row.pid, -row.pid])
        await until(() => owned.every((pid) => !alive(pid)))
        const browser = messages.find((row) => row.phase === "browser-registered")
        assert.ok(browser?.independentGroup && browser.profileOwned && browser.envVerified)
        assert.equal(
          messages.find((row) => row.phase === "owner-signal")?.beforeBrowserReady,
          stage === "startup",
        )
        assert.equal(messages.filter((row) => row.phase === "fixture-owned").length, 2)
        assert.deepEqual(result, { code: 130, signal: null })
        assert.ok(output.includes("OWNED_BROWSER_PROBE_STOPPED"))
        assert.ok(!output.includes("ws://") && !output.includes("OWNED_ENV_SECRET_SENTINEL"))
        assert.ok(alive(unrelated.pid) && alive(-unrelated.pid))
        console.log(
          JSON.stringify({
            stage,
            signalObservedBeforeBrowserReady: stage === "startup",
            exit: 130,
            browserIndependentGroupRegistered: true,
            profileOwned: true,
            browserEnvWhitelistVerified: true,
            fixtureAndWebGone: true,
            allOwnedPidsAndGroupsGone: true,
            unrelatedGroupAlive: true,
            wsCapabilityLogged: false,
          }),
        )
      } finally {
        child.kill("SIGTERM")
        await until(() => child.exitCode !== null || child.signalCode !== null, 15000).catch(() =>
          child.kill("SIGKILL"),
        )
        for (const pid of [child.pid, ...messages.filter((row) => row.pid).map((row) => row.pid)]) {
          try {
            process.kill(-pid, "SIGKILL")
          } catch {
            /* 仅本轮独占组。 */
          }
        }
        await until(() =>
          messages.filter((row) => row.pid).every((row) => !alive(row.pid) && !alive(-row.pid)),
        )
        await rm(dir, { recursive: true, force: true })
      }
    }
  } finally {
    try {
      process.kill(-unrelated.pid, "SIGKILL")
    } catch {
      /* 本探针自建无关对照组。 */
    }
    await until(() => !alive(unrelated.pid) && !alive(-unrelated.pid))
  }
}
