// 负责在独立运行目录中启动第一阶段本地服务，并以 loopback、健康门禁和有序退出管理进程。
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import net from "node:net"

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
const repositoryRoot = resolve(frontendRoot, "..")
const defaultPorts = { rust: 8788, home: 3000, admin: 5173 }
const shutdownTimeoutMs = 5_000

/** 返回 loopback 上一个当前可用的 TCP 端口。 */
export async function allocateLoopbackPort(preferredPort) {
  if (preferredPort && (await isPortAvailable(preferredPort))) return preferredPort
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close((error) => (error ? reject(error) : resolvePort(port)))
    })
  })
}

/** 检查 PostgreSQL 或 Redis 配置的 TCP 健康状态，缺省配置保持未验证。 */
export async function checkExternalDependency(name, value, timeoutMs = 1_500) {
  if (!value) return { name, status: "NOT VERIFIED", reason: "missing configuration" }
  let url
  try {
    url = new URL(value)
  } catch {
    return { name, status: "FAILED", reason: "invalid connection URL" }
  }
  const defaultPort = name === "postgres" ? 5432 : 6379
  const host = url.hostname || "127.0.0.1"
  if (!isLoopbackHost(host))
    return { name, status: "FAILED", host, reason: "non-loopback dependency host is not allowed" }
  const port = Number(url.port) || defaultPort
  try {
    await connectTcp(host, port, timeoutMs)
    return { name, status: "READY", host, port }
  } catch {
    return { name, status: "FAILED", host, port, reason: "TCP health check failed" }
  }
}

/** 启动本地 Rust、home 和 admin 进程，并返回可关闭的运行时句柄。 */
export async function startPhaseOneLauncher(env = process.env) {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "pigclaude-phase1-"))
  const processes = []
  const ports = {
    rust: await allocateLoopbackPort(Number(env.PIGCLAUDE_RUST_PORT) || defaultPorts.rust),
    home: await allocateLoopbackPort(Number(env.PIGCLAUDE_HOME_PORT) || defaultPorts.home),
    admin: await allocateLoopbackPort(Number(env.PIGCLAUDE_ADMIN_PORT) || defaultPorts.admin),
  }
  const dependencies = await Promise.all([
    checkExternalDependency("postgres", env.DATABASE_URL),
    checkExternalDependency("redis", env.REDIS_URL),
  ])
  const failedDependency = dependencies.find((dependency) => dependency.status === "FAILED")
  if (failedDependency) {
    await rm(runtimeDirectory, { recursive: true, force: true })
    throw new Error(`${failedDependency.name} health gate failed: ${failedDependency.reason}`)
  }

  const commonEnv = {
    ...env,
    PIGCLAUDE_SERVER_ADDR: `127.0.0.1:${ports.rust}`,
    PIGCLAUDE_HOME_URL: `http://127.0.0.1:${ports.home}`,
    PIGCLAUDE_ADMIN_URL: `http://127.0.0.1:${ports.admin}`,
  }
  try {
    processes.push(
      spawnService(
        "rust",
        "cargo",
        ["run", "--locked", "--manifest-path", "backend/Cargo.toml", "-p", "pigclaude-server"],
        repositoryRoot,
        commonEnv,
      ),
    )
    await waitForHttp(`http://127.0.0.1:${ports.rust}/healthz`)

    if (env.PIGCLAUDE_START_WEB !== "0") {
      processes.push(
        spawnService(
          "home",
          "pnpm",
          [
            "--dir",
            "frontend/apps/home",
            "exec",
            "next",
            "dev",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(ports.home),
          ],
          repositoryRoot,
          commonEnv,
        ),
        spawnService(
          "admin",
          "pnpm",
          [
            "--dir",
            "frontend/apps/admin",
            "exec",
            "vite",
            "--host",
            "127.0.0.1",
            "--port",
            String(ports.admin),
          ],
          repositoryRoot,
          commonEnv,
        ),
      )
      await waitForHttp(`http://127.0.0.1:${ports.home}/`)
      await waitForHttp(`http://127.0.0.1:${ports.admin}/`)
    }
  } catch (error) {
    for (const process of [...processes].reverse()) await stopService(process)
    await rm(runtimeDirectory, { recursive: true, force: true })
    throw error
  }

  const manifest = {
    runtimeDirectory,
    listener: {
      rust: `127.0.0.1:${ports.rust}`,
      home: `127.0.0.1:${ports.home}`,
      admin: `127.0.0.1:${ports.admin}`,
    },
    dependencies,
    electron: { status: "NOT VERIFIED", reason: "packaged Electron requires a GUI session" },
    processes: processes.map(({ name, child }) => ({ name, pid: child.pid ?? null })),
  }
  await writeFile(join(runtimeDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return {
    manifest,
    async shutdown() {
      for (const process of [...processes].reverse()) await stopService(process)
      if (env.PIGCLAUDE_KEEP_RUNTIME !== "1")
        await rm(runtimeDirectory, { recursive: true, force: true })
    },
  }
}

function spawnService(name, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: "inherit" })
  child.once("error", (error) => console.error(`${name} process failed: ${error.message}`))
  return { name, child }
}

async function stopService(service) {
  if (service.child.exitCode !== null) return
  signalProcessGroup(service.child, "SIGTERM")
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      signalProcessGroup(service.child, "SIGKILL")
      resolveStop()
    }, shutdownTimeoutMs)
    service.child.once("exit", () => {
      clearTimeout(timer)
      resolveStop()
    })
  })
}

function signalProcessGroup(child, signal) {
  try {
    if (child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    child.kill(signal)
  }
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 进程刚启动时连接失败，继续等待健康门禁。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`HTTP health gate timed out: ${url}`)
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolveConnection, reject) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error("timeout"))
    }, timeoutMs)
    socket.once("connect", () => {
      clearTimeout(timer)
      socket.end()
      resolveConnection()
    })
    socket.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function isPortAvailable(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(200) })
    return false
  } catch {
    // 没有可用 HTTP 服务时继续用 TCP bind 检查端口占用。
  }
  return new Promise((resolveAvailable) => {
    const server = net.createServer()
    server.once("error", () => resolveAvailable(false))
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolveAvailable(true))
    })
  })
}

function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1"
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let launcher
  try {
    launcher = await startPhaseOneLauncher()
    console.log(JSON.stringify(launcher.manifest, null, 2))
    const shutdown = async () => {
      await launcher.shutdown()
      process.exit(0)
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
