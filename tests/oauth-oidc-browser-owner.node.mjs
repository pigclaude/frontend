// 负责验证受信browser登记、脱组回收、runner缺能力失败关闭及WS错误不泄露控制地址。
import test from "node:test"
import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { createOAuthLifecycle } from "../scripts/oauth-oidc-process-lifecycle.mjs"

test("未完成浏览器监督登记不得启动runner", async () => {
  const owner = createOAuthLifecycle()
  let child
  try {
    assert.throws(() => {
      child = owner.spawn(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        { stdio: "ignore" },
        "runner",
      )
    }, /OAUTH_TEST_BROWSER_SUPERVISION_REQUIRED/)
    await assert.rejects(owner.shutdown(), /OAUTH_TEST_CLEANUP_FAILED/)
  } finally {
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        /* 仅本例已知组。 */
      }
    }
    await owner.shutdown().catch(() => undefined)
    owner.dispose()
  }
})

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
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
async function gone(pids) {
  const until = Date.now() + 9000
  while (pids.some(alive) && Date.now() < until) await pause(25)
  assert.ok(
    pids.every((pid) => !alive(pid)),
    "all owned PIDs and PGIDs must be gone",
  )
}
function resistant() {
  return childProcess.spawn(
    process.execPath,
    ["-e", 'process.on("SIGTERM",()=>{});process.send({ready:true});setInterval(()=>{},1000)'],
    { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
  )
}
const workerProgram =
  'process.on("SIGTERM",()=>{});process.send({ready:true});setInterval(()=>{},1000)'
const runnerProgram = `const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});process.on('SIGUSR2',()=>process.exit(0));const w=spawn(process.execPath,['-e',${JSON.stringify(workerProgram)}],{stdio:['ignore','ignore','ignore','ipc']});w.once('message',()=>process.send({worker:w.pid}));setInterval(()=>{},1000)`
for (const mode of ["resistant", "leader-zero", "worker-kill"]) {
  test(`真实登记边界在${mode}时回收另组browser且保留无关组`, { timeout: 25000 }, async () => {
    const { startOwnedOAuthBrowser } = await import("../scripts/oauth-oidc-browser-owner.mjs")
    const owner = createOAuthLifecycle()
    const unrelated = resistant()
    let browser, runner, worker
    const original = childProcess.spawn
    try {
      const controlled = await startOwnedOAuthBrowser(owner, {
        launchServer: async () => {
          browser = resistant()
          await new Promise((done) => browser.once("message", done))
          return {
            process: () => browser,
            wsEndpoint: () => "ws://127.0.0.1:12345/OWNED_WS_SECRET_SENTINEL",
            close: async () => undefined,
          }
        },
      })
      assert.equal(childProcess.spawn, original)
      assert.equal(controlled.process, browser)
      runner = owner.spawn(
        process.execPath,
        ["-e", runnerProgram],
        { stdio: ["ignore", "ignore", "ignore", "ipc"] },
        "runner",
      )
      worker = await new Promise((done) => runner.once("message", (value) => done(value.worker)))
      assert.ok(Number.isInteger(worker) && worker > 1, "worker IPC must identify the owned PID")
      if (mode !== "resistant") {
        const exited = new Promise((done) => runner.once("exit", done))
        if (mode === "worker-kill") {
          process.kill(worker, "SIGKILL")
          runner.kill("SIGKILL")
        } else runner.kill("SIGUSR2")
        await exited
      }
      await Promise.all([owner.shutdown(), owner.shutdown()])
      await gone([runner.pid, -runner.pid, browser.pid, -browser.pid, worker])
      assert.ok(alive(unrelated.pid) && alive(-unrelated.pid))
    } finally {
      await owner.shutdown().catch(() => undefined)
      owner.dispose()
      for (const child of [runner, browser, unrelated])
        if (child?.pid) {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {
            /* 只清理本例登记组。 */
          }
        }
      await gone(
        [runner?.pid, browser?.pid, unrelated.pid].filter(Boolean).flatMap((pid) => [pid, -pid]),
      )
      assert.equal(childProcess.spawn, original)
    }
  })
}

test("launch异常/登记不符会恢复spawn且固定失败，不误杀未登记组", async () => {
  const { startOwnedOAuthBrowser } = await import("../scripts/oauth-oidc-browser-owner.mjs")
  const original = childProcess.spawn
  for (const kind of ["throw", "mismatch"]) {
    const owner = createOAuthLifecycle()
    const unrelated = resistant()
    let owned
    try {
      await assert.rejects(
        startOwnedOAuthBrowser(owner, {
          launchServer: async () => {
            if (kind === "throw") {
              owned = resistant()
              await new Promise((done) => owned.once("message", done))
              throw new Error("ws://127.0.0.1:1/OWNED_WS_SECRET_SENTINEL")
            }
            return {
              process: () => unrelated,
              wsEndpoint: () => "ws://127.0.0.1:1/OWNED_WS_SECRET_SENTINEL",
              close: async () => undefined,
            }
          },
        }),
        (error) => error.message === "OAUTH_TEST_BROWSER_START_FAILED" && error.cause === undefined,
      )
      assert.equal(childProcess.spawn, original)
      await assert.rejects(owner.shutdown(), /OAUTH_TEST_CLEANUP_FAILED/)
      if (owned) await gone([owned.pid, -owned.pid])
      assert.ok(alive(unrelated.pid) && alive(-unrelated.pid))
    } finally {
      await owner.shutdown().catch(() => undefined)
      owner.dispose()
      for (const child of [owned, unrelated])
        if (child?.pid) {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {
            /* 仅本例已知组。 */
          }
        }
      await gone([owned?.pid, unrelated.pid].filter(Boolean).flatMap((pid) => [pid, -pid]))
    }
  }
})

test("真实Playwright连接失败的reporter不输出WS控制sentinel", { timeout: 30000 }, async () => {
  const { createServer } = await import("node:http")
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const dir = await mkdtemp(join(tmpdir(), "oauth-ws-failure-"))
  const server = createServer((_req, res) => res.writeHead(503).end())
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  const endpoint = `ws://127.0.0.1:${server.address().port}/OWNED_WS_CONTROL_SENTINEL`
  const fixture = fileURLToPath(new URL("./oauth-oidc-owned-browser.ts", import.meta.url))
  await writeFile(
    join(dir, "probe.spec.ts"),
    `import { test } from ${JSON.stringify(fixture)};test("owned connection failure",async({page})=>{await page.goto("about:blank")})`,
  )
  await writeFile(
    join(dir, "config.mjs"),
    `export default { testDir:${JSON.stringify(dir)},testMatch:"probe.spec.ts",workers:1,retries:0,reporter:"line",timeout:15000,use:{trace:"off",screenshot:"off",video:"off"} }`,
  )
  try {
    const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url))
    const result = await new Promise((done) =>
      childProcess.execFile(
        process.execPath,
        [cli, "test", "--config", join(dir, "config.mjs")],
        {
          cwd: dir,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            PLAYWRIGHT_NO_COPY_PROMPT: "1",
            OAUTH_TEST_BROWSER_WS: endpoint,
          },
        },
        (error, stdout, stderr) => done({ code: error?.code ?? 0, output: stdout + stderr }),
      ),
    )
    assert.equal(result.code, 1)
    assert.ok(result.output.includes("OAUTH_TEST_BROWSER_CONNECT_FAILED"))
    assert.ok(
      !result.output.includes("OWNED_WS_CONTROL_SENTINEL") && !result.output.includes("ws://"),
      "reporter must redact WS capability",
    )
  } finally {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
    await rm(dir, { recursive: true, force: true })
  }
})

test("owner调试env会在浏览器启动前失败关闭", async () => {
  const { startOwnedOAuthBrowser } = await import("../scripts/oauth-oidc-browser-owner.mjs")
  const owner = createOAuthLifecycle()
  const previous = process.env.DEBUG
  let called = false
  process.env.DEBUG = "owned-debug-sentinel"
  try {
    await assert.rejects(
      startOwnedOAuthBrowser(owner, {
        launchServer: async () => {
          called = true
          throw new Error("owned")
        },
      }),
      /OAUTH_TEST_BROWSER_DEBUG_ENV_NOT_ALLOWED/,
    )
    assert.equal(called, false)
  } finally {
    if (previous === undefined) delete process.env.DEBUG
    else process.env.DEBUG = previous
    await owner.shutdown().catch(() => undefined)
    owner.dispose()
  }
})

test("初次收尾后才发现监督登记不符也不能再次返回清理成功", { timeout: 15000 }, async () => {
  const { startOwnedOAuthBrowser } = await import("../scripts/oauth-oidc-browser-owner.mjs")
  const owner = createOAuthLifecycle()
  const unrelated = resistant()
  let browser, release, registered
  const ready = new Promise((done) => {
    registered = done
  })
  const gate = new Promise((done) => {
    release = done
  })
  const launching = startOwnedOAuthBrowser(owner, {
    launchServer: async () => {
      browser = resistant()
      await new Promise((done) => browser.once("message", done))
      registered()
      await gate
      return {
        process: () => unrelated,
        wsEndpoint: () => "ws://127.0.0.1:1/OWNED_WS_SECRET_SENTINEL",
        close: async () => undefined,
      }
    },
  })
  try {
    await ready
    await owner.shutdown()
    release()
    await assert.rejects(launching, /OAUTH_TEST_BROWSER_START_FAILED/)
    await assert.rejects(owner.shutdown(), /OAUTH_TEST_CLEANUP_FAILED/)
    await gone([browser.pid, -browser.pid])
    assert.ok(alive(unrelated.pid) && alive(-unrelated.pid))
  } finally {
    release()
    await launching.catch(() => undefined)
    await owner.shutdown().catch(() => undefined)
    owner.dispose()
    for (const child of [browser, unrelated])
      if (child?.pid) {
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch {
          /* 本例已知组。 */
        }
      }
    await gone([browser?.pid, unrelated.pid].filter(Boolean).flatMap((pid) => [pid, -pid]))
  }
})
