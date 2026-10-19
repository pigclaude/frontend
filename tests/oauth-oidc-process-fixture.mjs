// 负责以真实独占进程替代昂贵构建/服务，保留入口的spawn、信号与后代回收行为。
import childProcess from "node:child_process"
import { syncBuiltinESMExports } from "node:module"
import { appendFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
const file = fileURLToPath(import.meta.url)
const record = (value) =>
  appendFileSync(process.env.OAUTH_PROCESS_RECORD, JSON.stringify(value) + "\n")
if (process.argv[2] === "--child") {
  const role = process.argv[3]
  if (role === "build" && !["build", "build-fail"].includes(process.env.OAUTH_PROCESS_STAGE))
    process.exit(0)
  if (role === "build" && process.env.OAUTH_PROCESS_STAGE === "build-fail") process.exit(3)
  const grandchild = childProcess.spawn(
    process.execPath,
    [
      "-e",
      (["stubborn", "exited-stubborn", "late-stubborn"].includes(process.env.OAUTH_PROCESS_STAGE) &&
      role === "runner"
        ? 'process.on("SIGTERM", () => {});process.send("ready");'
        : "") + "setInterval(() => {}, 1000)",
    ],
    {
      stdio:
        ["stubborn", "exited-stubborn", "late-stubborn"].includes(
          process.env.OAUTH_PROCESS_STAGE,
        ) && role === "runner"
          ? ["ignore", "ignore", "ignore", "ipc"]
          : "ignore",
    },
  )
  record({ role, pid: process.pid, descendant: grandchild.pid })
  const started = () => {
    record({ started: role })
    if (
      role === "runner" &&
      ["exited-stubborn", "late-stubborn"].includes(process.env.OAUTH_PROCESS_STAGE)
    )
      process.exit(0)
  }
  if (
    ["stubborn", "exited-stubborn", "late-stubborn"].includes(process.env.OAUTH_PROCESS_STAGE) &&
    role === "runner"
  )
    grandchild.once("message", started)
  else started()
  if (
    role === "runner" &&
    ["success", "failure", "cleanup"].includes(process.env.OAUTH_PROCESS_STAGE)
  )
    process.exit(process.env.OAUTH_PROCESS_STAGE === "failure" ? 7 : 0)
  if (role === "fixture" && process.env.OAUTH_PROCESS_STAGE === "fixture-exit") process.exit(2)
  process.on("SIGTERM", () => {
    record({ stopped: role })
    process.exit(0)
  })
  if (role === "fixture") {
    process.stdin.resume()
    process.stdin.on("end", () => {
      record({ stopped: role })
      if (process.env.OAUTH_PROCESS_STAGE === "cleanup") setTimeout(() => process.exit(0), 1500)
      else process.exit(0)
    })
    if (process.env.OAUTH_PROCESS_STAGE !== "fixture")
      console.log(
        JSON.stringify({
          ready: true,
          api: "http://127.0.0.1:1",
          api2: "http://127.0.0.1:2",
          control: "http://127.0.0.1:3",
        }),
      )
  }
  if (role === "fixture" && ["late-failure", "late-zero"].includes(process.env.OAUTH_PROCESS_STAGE))
    process.on("SIGUSR2", () =>
      process.exit(process.env.OAUTH_PROCESS_STAGE === "late-zero" ? 0 : 2),
    )
  if (
    role === "home" &&
    ["late-web-failure", "late-stubborn"].includes(process.env.OAUTH_PROCESS_STAGE)
  )
    process.on("SIGUSR2", () => process.exit(4))
  setInterval(() => {}, 1000)
} else {
  const original = childProcess.spawn
  childProcess.spawn = (command, args, options) => {
    const role =
      command === "cargo"
        ? "build"
        : command.endsWith("oauth-live-fixture")
          ? "fixture"
          : args.includes("playwright")
            ? "runner"
            : args.includes("next")
              ? "home"
              : "admin"
    if (role === "admin" && process.env.OAUTH_PROCESS_STAGE === "admin-fail")
      throw new Error("OWNED_START_FAILURE")
    const spawned = original(process.execPath, [file, "--child", role], {
      ...options,
      env: {
        ...process.env,
        ...options.env,
        OAUTH_PROCESS_STAGE: process.env.OAUTH_PROCESS_STAGE,
        OAUTH_PROCESS_RECORD: process.env.OAUTH_PROCESS_RECORD,
      },
    })
    record({ ownerRole: role, pid: spawned.pid })
    spawned.once("exit", (code, signal) => record({ exited: role, code, signal }))
    if (spawned.stderr)
      spawned.stderr.on("data", (chunk) => record({ diagnostic: chunk.toString() }))
    return spawned
  }
  globalThis.fetch = async (_url, options) => {
    if (process.env.OAUTH_PROCESS_STAGE === "web") {
      await new Promise((done, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        setTimeout(done, 100)
      })
      throw new Error("not ready")
    }
    return { status: 200 }
  }
  syncBuiltinESMExports()
}
