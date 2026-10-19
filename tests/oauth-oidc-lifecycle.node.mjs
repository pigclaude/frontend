// 负责验证两个真实CLI入口在启动各阶段取消后回收全部自有后代，保留信号退出码。
import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../..", import.meta.url))
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
async function until(check, limit = 8000) {
  const deadline = Date.now() + limit
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((done) => setTimeout(done, 25))
  }
  throw new Error("PROCESS_CONDITION_TIMEOUT")
}
async function runCase(entry, stage, signal, expected) {
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  })
  const dir = await mkdtemp(resolve(tmpdir(), "oauth-process-"))
  const record = resolve(dir, "record.jsonl")
  const privateFile = resolve(dir, "private.json")
  await writeFile(privateFile, "{}", { mode: 0o600 })
  const metadata = resolve(dir, "metadata.json")
  await writeFile(
    metadata,
    JSON.stringify({
      owner: "oauth-oidc",
      workspace: root.replace(/\/$/, ""),
      host: "127.0.0.1",
      namespace: "oauth-oidc:12345678:",
      postgres_port: "63001",
      redis_port: "63002",
      postgres_database: "pigclaude_oauth_test_123abc",
      postgres_role: "owner",
      private_env_file: privateFile,
    }),
  )
  const child = spawn(
    process.execPath,
    [
      "--import",
      resolve(root, "frontend/tests/oauth-oidc-process-fixture.mjs"),
      resolve(root, "frontend/scripts", entry),
    ],
    {
      cwd: resolve(root, "frontend"),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DATABASE_URL: "postgres://owner:local@127.0.0.1:63001/pigclaude_oauth_test_123abc",
        PIGCLAUDE_SETTINGS_TEST_DATABASE_URL:
          "postgres://owner:local@127.0.0.1:63001/pigclaude_oauth_test_123abc",
        REDIS_URL: "redis://:local@127.0.0.1:63002/",
        OAUTH_TEST_OWNER: "oauth-oidc:12345678:",
        OAUTH_TEST_INFRA_FILE: metadata,
        OAUTH_PROCESS_STAGE: stage,
        OAUTH_PROCESS_RECORD: record,
      },
    },
  )
  let output = ""
  child.stdout.on("data", (chunk) => {
    output += chunk
  })
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  const exited = new Promise((done) =>
    child.once("exit", (code, sig) => done({ code, signal: sig })),
  )
  const rows = async () => {
    try {
      return (await readFile(record, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }
  let owned = []
  try {
    if (signal || stage.startsWith("late-")) {
      await until(async () => {
        const entries = await rows()
        const role =
          stage === "browser-start"
            ? "browser"
            : stage === "cleanup" || ["late-failure", "late-zero"].includes(stage)
              ? "fixture"
              : ["late-web-failure", "late-stubborn"].includes(stage)
                ? "home"
                : stage === "web" || stage === "ready"
                  ? "admin"
                  : ["stubborn", "exited-stubborn"].includes(stage)
                    ? "runner"
                    : stage
        return (
          (stage === "cleanup"
            ? entries.some((row) => row.stopped === "fixture")
            : entries.some((row) => row.role === role)) &&
          (!["stubborn", "exited-stubborn"].includes(stage) ||
            entries.some((row) => row.started === "runner")) &&
          (!["exited-stubborn", "late-stubborn"].includes(stage) ||
            entries.some((row) => row.exited === "runner")) &&
          (!(stage === "ready" || stage.startsWith("late-")) ||
            (output.includes('"ready":true') && entries.some((row) => row.role === "admin")))
        )
      })
    }
    owned = (await rows()).flatMap((row) =>
      row.pid
        ? row.ownerRole
          ? [row.pid, -row.pid]
          : [row.pid, row.descendant].filter(Boolean)
        : [],
    )
    if (stage.startsWith("late-")) {
      const role = ["late-web-failure", "late-stubborn"].includes(stage) ? "home" : "fixture"
      process.kill((await rows()).find((row) => row.role === role).pid, "SIGUSR2")
    }
    if (signal) {
      child.kill(signal)
      child.kill(signal)
    }
    await until(() => child.exitCode !== null || child.signalCode !== null, 12000)
    const result = await exited
    owned = (await rows()).flatMap((row) =>
      row.pid
        ? row.ownerRole
          ? [row.pid, -row.pid]
          : [row.pid, row.descendant].filter(Boolean)
        : [],
    )
    await until(() => owned.every((pid) => !alive(pid)))
    assert.ok(alive(unrelated.pid), "unrelated process must stay alive")
    assert.deepEqual(
      result,
      { code: signal ? (signal === "SIGTERM" ? 143 : 130) : expected, signal: null },
      output + JSON.stringify(await rows()),
    )
    assert.ok(
      output.includes(
        ["fixture-exit", "late-failure"].includes(stage)
          ? "OAUTH_TEST_CLEANUP_FAILED"
          : "OWNED_PROCESSES_STOPPED",
      ),
    )
    if (stage === "runner" || stage === "success" || stage === "failure") {
      const stopped = (await rows())
        .filter((row) => row.stopped || row.exited)
        .map((row) => row.stopped || row.exited)
      assert.ok(
        stopped.indexOf("runner") >= 0 && stopped.indexOf("runner") < stopped.indexOf("fixture"),
      )
    }
  } finally {
    unrelated.kill("SIGKILL")
    child.kill("SIGTERM")
    await until(() => child.exitCode !== null || child.signalCode !== null, 12000).catch(() =>
      child.kill("SIGKILL"),
    )
    owned = (await rows()).flatMap((row) =>
      row.pid
        ? row.ownerRole
          ? [row.pid, -row.pid]
          : [row.pid, row.descendant].filter(Boolean)
        : [],
    )
    for (const pid of owned)
      if (alive(pid)) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          /* 仅清理本例已记录PID。 */
        }
      }
    await until(() => owned.every((pid) => !alive(pid)))
    await until(() => !alive(unrelated.pid))
    await rm(dir, { recursive: true, force: true })
  }
}
for (const [entry, stages] of [
  ["oauth-oidc-e2e.mjs", ["build", "fixture", "web", "runner"]],
  ["oauth-oidc-local-launcher.mjs", ["fixture", "web", "ready"]],
]) {
  for (const stage of stages)
    for (const signal of ["SIGTERM", "SIGINT"]) {
      test(`${entry} ${stage} ${signal} 幂等取消回收全部owned后代`, { timeout: 20000 }, () =>
        runCase(entry, stage, signal),
      )
    }
}
for (const [stage, expected] of [
  ["success", 0],
  ["failure", 7],
  ["build-fail", 3],
  ["fixture-exit", 1],
  ["admin-fail", 1],
]) {
  test(`e2e ${stage} 回收部分启动和已退出leader的后代`, { timeout: 20000 }, () =>
    runCase("oauth-oidc-e2e.mjs", stage, undefined, expected),
  )
}

test("runner忽略TERM时仍有界KILL整个owned group", { timeout: 20000 }, () =>
  runCase("oauth-oidc-e2e.mjs", "stubborn", "SIGTERM"),
)

test("runner已退出但后代清理中取消仍保留143", { timeout: 20000 }, () =>
  runCase("oauth-oidc-e2e.mjs", "exited-stubborn", "SIGTERM"),
)

test("正常fixture收尾已开始时取消仍保留143", { timeout: 20000 }, () =>
  runCase("oauth-oidc-e2e.mjs", "cleanup", "SIGTERM"),
)

for (const entry of ["oauth-oidc-e2e.mjs", "oauth-oidc-local-launcher.mjs"]) {
  test(`${entry} ready后fixture失败也回收全部owned组`, { timeout: 20000 }, () =>
    runCase(entry, "late-failure", undefined, 1),
  )
}

for (const entry of ["oauth-oidc-e2e.mjs", "oauth-oidc-local-launcher.mjs"]) {
  for (const stage of ["late-web-failure", "late-zero"]) {
    test(`${entry} ${stage} ready后明确事件触发也回收owned组`, { timeout: 20000 }, () =>
      runCase(entry, stage, undefined, 1),
    )
  }
}

test("runner组收尾期间web意外退出仍失败而非返回0", { timeout: 20000 }, () =>
  runCase("oauth-oidc-e2e.mjs", "late-stubborn", undefined, 1),
)

for (const signal of ["SIGINT", "SIGTERM"])
  test(`e2e browser启动中${signal}仍唯一owner收尾`, { timeout: 20000 }, () =>
    runCase("oauth-oidc-e2e.mjs", "browser-start", signal),
  )
