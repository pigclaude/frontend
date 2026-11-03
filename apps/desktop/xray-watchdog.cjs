// 管理单次 Xray 生命周期，并由持有进程组的成员处理宿主或守护进程意外退出。

const { execFileSync, spawn } = require("node:child_process")

if (process.argv[2] === "--guard") runGuard()
else runWatchdog()

function runGuard() {
  const group = Number(process.argv[3])
  try {
    const actual = Number(
      execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], {
        encoding: "utf8",
        timeout: 2_000,
      }).trim(),
    )
    if (!Number.isInteger(group) || group <= 0 || actual !== group) process.exit(1)
  } catch {
    process.exit(1)
  }
  const stopGroup = () => {
    try {
      // 本进程始终属于该组；发信号时组身份仍由自身持有，不会命中复用的组号。
      process.kill(-group, "SIGKILL")
    } catch {
      process.exit(1)
    }
  }
  process.stdin.on("end", stopGroup)
  process.stdin.on("error", stopGroup)
  process.stdout.on("error", stopGroup)
  process.stdin.resume()
  process.stdout.write("GUARD_READY\n")
}

function runWatchdog() {
  const binary = process.argv[2]
  let input = ""
  let guard = null
  let child = null
  let closing = false
  let ready = false
  let forceTimer
  let exitTimer

  function finish(code) {
    clearTimeout(forceTimer)
    clearTimeout(exitTimer)
    process.exit(code)
  }

  function stop() {
    if (closing) return
    closing = true
    if (child === null || child.exitCode !== null || child.signalCode !== null) {
      finish(0)
      return
    }
    child.kill("SIGTERM")
    forceTimer = setTimeout(() => child.kill("SIGKILL"), 1_500)
    exitTimer = setTimeout(() => finish(1), 2_500)
  }

  function startXray(config) {
    if (!binary || closing) return stop()
    child = spawn(binary, ["run", "-config", "stdin:"], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    })
    child.on("error", stop)
    child.stdin.on("error", stop)
    child.once("exit", () => finish(closing ? 0 : 1))
    let output = ""
    child.stdout.on("data", (chunk) => {
      if (ready) return
      output = (output + chunk.toString("utf8")).slice(-16_384)
      if (/core: Xray [^\r\n]+ started(?:\r?\n|$)/.test(output)) {
        ready = true
        output = ""
        process.stdout.write("XRAY_READY\n")
      }
    })
    child.stdin.end(config)
  }

  function start(config) {
    if (process.platform === "win32") return startXray(config)
    guard = spawn(process.execPath, [__filename, "--guard", String(process.pid)], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    })
    guard.on("error", stop)
    guard.stdin.on("error", stop)
    guard.once("exit", stop)
    let output = ""
    guard.stdout.on("data", (chunk) => {
      output = (output + chunk.toString("utf8")).slice(-1024)
      if (output.includes("GUARD_READY\n")) {
        guard.stdout.removeAllListeners("data")
        guard.stdout.resume()
        startXray(config)
      }
    })
  }

  process.stdout.on("error", stop)
  process.stdin.on("error", stop)
  process.stdin.on("end", stop)
  process.on("SIGTERM", stop)
  process.on("SIGINT", stop)
  process.stdin.on("data", (chunk) => {
    if (guard !== null || child !== null || closing) return
    input += chunk.toString("utf8")
    if (Buffer.byteLength(input) > 131_072) return stop()
    const boundary = input.indexOf("\n")
    if (boundary === -1) return
    const config = input.slice(0, boundary)
    input = ""
    start(config)
  })
}
