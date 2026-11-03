// 负责通过标准输入启动和回收 Xray，并将本机 SOCKS5 入口连接到账号绑定的上游代理。

import { spawn, type ChildProcess } from "node:child_process"
import { connect, createServer } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ProxyRuntime, StartProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import { ClaudeAccountError } from "./errors"
import { matchesRuntimeBinary, runtimeHostArch } from "./runtime-binary"
import { createXrayRuntimePool, type StartXrayCore } from "./xray-runtime-pool"
import { XrayPortInUseError, XrayStartupCleanupError } from "./xray-runtime-errors"

/** Xray 运行实例的可执行文件和启动超时。 */
export type XrayRuntimeOptions = {
  binaryPath?: string
  resourcesPath?: string
  env?: Record<string, string | undefined>
  hostPlatform?: NodeJS.Platform
  hostArch?: string
  startupTimeoutMs?: number
  /** 无引用后延迟回收的时间；默认与 Ant Browser 一致为 45 秒。 */
  idleTimeoutMs?: number
  /** 测试可注入进程创建函数，正式运行使用系统 spawn。 */
  spawn?: typeof spawn
  /** 测试可注入端口分配函数，正式运行使用系统分配。 */
  allocatePort?: () => Promise<number>
}

/** 可关闭全部已启动和正在启动实例的 Xray 启动器。 */
export type XrayRuntimeStarter = StartProxyRuntime & { dispose: () => Promise<void> }

/** 创建 Xray 启动器；上游凭据只经子进程标准输入传递，失败不切换直连。 */
export function createXrayRuntimeStarter(options: XrayRuntimeOptions): XrayRuntimeStarter {
  let disposed = false
  let disposePromise: Promise<void> | undefined
  const children = new Set<ChildProcess>()
  const pending = new Set<Promise<ProxyRuntime>>()
  const stopping = new WeakMap<ChildProcess, Promise<void>>()
  const closing = new WeakSet<ChildProcess>()
  const closeChild = (child: ChildProcess): Promise<void> => {
    closing.add(child)
    const existing = stopping.get(child)
    if (existing !== undefined) return existing
    const promise = stop(child)
    stopping.set(child, promise)
    void promise.catch(() => {
      if (stopping.get(child) === promise) stopping.delete(child)
    })
    return promise
  }
  const startAttempt: StartXrayCore = async ({ upstreamProxyUrl, port: requestedPort }) => {
    const platform = options.hostPlatform ?? process.platform
    const arch = options.hostArch ?? runtimeHostArch()
    const configured = options.binaryPath ?? (options.env ?? process.env)["PIGCLAUDE_XRAY_BIN"]
    const binaryPath =
      configured ||
      (options.resourcesPath === undefined
        ? undefined
        : join(
            options.resourcesPath,
            "pigclaude-runtime",
            "xray",
            `${platform}-${arch}`,
            platform === "win32" ? "xray.exe" : "xray",
          ))
    if (!binaryPath || !(await matchesRuntimeBinary(binaryPath, platform, arch)))
      throw unavailable()
    const upstream = parseUpstream(upstreamProxyUrl)
    const port = requestedPort ?? (await (options.allocatePort ?? reservePort)())
    if (disposed) throw unavailable()
    const config = {
      log: { loglevel: "warning" },
      inbounds: [{ listen: "127.0.0.1", port, protocol: "socks", settings: { udp: true } }],
      outbounds: [
        {
          protocol: "http",
          settings: upstream.settings,
          ...(upstream.tls ? { streamSettings: { security: "tls" } } : {}),
        },
      ],
    }
    let child: ChildProcess | null = null
    let exited: Promise<void> | undefined
    let started = false
    let xrayExited = false
    let lifecycleOutput = ""
    const cleanupChild = async (target: ChildProcess) => {
      if (target.pid === undefined) {
        children.delete(target)
        return
      }
      if (target.exitCode === null && target.signalCode === null) await closeChild(target)
      await waitForPortRelease(port)
      children.delete(target)
    }
    try {
      const watchdog = watchdogPath(options.resourcesPath)
      const spawned = (options.spawn ?? spawn)(process.execPath, [watchdog, binaryPath], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        detached: process.platform !== "win32",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      })
      child = spawned
      children.add(spawned)
      spawned.stdout?.on("data", (chunk: Buffer) => {
        lifecycleOutput = (lifecycleOutput + chunk.toString("utf8")).slice(-1_024)
        if (lifecycleOutput.includes("XRAY_EXITED\n")) xrayExited = true
      })
      exited = new Promise<void>((resolve, reject) => {
        spawned.once("close", (code, signal) => {
          if (!started && xrayExited) {
            children.delete(spawned)
            resolve()
            return
          }
          if (!started && (code !== 0 || signal !== null) && !xrayExited) {
            resolve()
            return
          }
          void waitForPortRelease(port).then(() => {
            children.delete(spawned)
            resolve()
          }, reject)
        })
        spawned.once("error", reject)
      })
      void exited.catch(() => undefined)
      spawned.on("error", () => undefined)
      spawned.stdin?.on("error", () => undefined)
      await waitForStart(spawned, JSON.stringify(config), options.startupTimeoutMs ?? 5_000)
      started = true
      if (disposed) throw unavailable()
    } catch {
      if (child !== null) {
        const failedChild = child
        if (!started && (failedChild.exitCode !== null || failedChild.signalCode !== null)) {
          await exited?.catch(() => undefined)
        }
        if (!started && xrayExited && (await isPortOpen(port))) {
          children.delete(failedChild)
          throw new XrayPortInUseError()
        }
        try {
          await cleanupChild(failedChild)
        } catch {
          throw new XrayStartupCleanupError(() => cleanupChild(failedChild))
        }
      }
      throw unavailable()
    }
    const running = child
    if (exited === undefined) throw unavailable()
    return {
      url: `socks5://127.0.0.1:${port}`,
      exited,
      close: () => cleanupChild(running),
      assertRunning: () => {
        if (
          disposed ||
          xrayExited ||
          closing.has(running) ||
          !children.has(running) ||
          running.exitCode !== null ||
          running.signalCode !== null
        )
          throw unavailable()
      },
    }
  }
  const startOne: StartXrayCore = async (input) => {
    try {
      return await startAttempt(input)
    } catch (error: unknown) {
      if (input.port === undefined && error instanceof XrayPortInUseError)
        return startAttempt(input)
      throw error
    }
  }
  const pool = createXrayRuntimePool(startOne, options.idleTimeoutMs ?? 45_000)
  const start: XrayRuntimeStarter = Object.assign(
    (input: { upstreamProxyUrl: string }) => {
      if (disposed) return Promise.reject(unavailable())
      const task = pool(input)
      pending.add(task)
      void task.then(
        () => pending.delete(task),
        () => pending.delete(task),
      )
      return task
    },
    {
      dispose: () => {
        disposed = true
        if (disposePromise !== undefined) return disposePromise
        const promise = (async () => {
          const pooled = await Promise.allSettled([pool.dispose()])
          const stopped = await Promise.allSettled([...children].map(closeChild))
          await Promise.allSettled([...pending])
          if ([...pooled, ...stopped].some((result) => result.status === "rejected"))
            throw unavailable()
        })()
        disposePromise = promise
        void promise.catch(() => {
          if (disposePromise === promise) disposePromise = undefined
        })
        return promise
      },
    },
  )
  return start
}

function watchdogPath(resourcesPath: string | undefined): string {
  if (process.versions.electron !== undefined && resourcesPath !== undefined) {
    return join(resourcesPath, "xray-watchdog.cjs")
  }
  const moduleDirectory =
    typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url))
  return process.versions.electron === undefined
    ? join(moduleDirectory, "../../../xray-watchdog.cjs")
    : join(moduleDirectory, "../../xray-watchdog.cjs")
}

function parseUpstream(value: string): {
  settings: {
    servers: Array<{ address: string; port: number; users?: Array<{ user: string; pass: string }> }>
  }
  tls: boolean
} {
  try {
    const url = new URL(value)
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw unavailable()
    }
    const user = decodeURIComponent(url.username)
    const pass = decodeURIComponent(url.password)
    return {
      settings: {
        servers: [
          {
            address: url.hostname.replace(/^\[|\]$/g, ""),
            port: url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port),
            ...(user !== "" || pass !== "" ? { users: [{ user, pass }] } : {}),
          },
        ],
      },
      tls: url.protocol === "https:",
    }
  } catch {
    throw unavailable()
  }
}

async function reservePort(): Promise<number> {
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (address === null || typeof address === "string") throw unavailable()
    return address.port
  } catch {
    throw unavailable()
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function waitForPortRelease(port: number): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw unavailable()
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1")
    socket.setTimeout(500, () => socket.destroy(new Error("Xray 端口检查超时")))
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") resolve(false)
      else reject(error)
    })
  })
}

async function waitForStart(child: ChildProcess, config: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => finish(false), timeoutMs)
    const finish = (started: boolean) => {
      clearTimeout(timer)
      child.off("error", failed)
      child.off("exit", failed)
      child.stdout?.off("data", onData)
      child.stdin?.off("error", failed)
      child.stdout?.resume()
      if (started) resolve()
      else reject(unavailable())
    }
    const failed = () => finish(false)
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-16_384)
      if (output.includes("XRAY_READY\n")) finish(true)
    }
    child.once("error", failed)
    child.once("exit", failed)
    child.stdout?.on("data", onData)
    child.stdin?.once("error", failed)
    child.stdin?.write(`${config}\n`)
  })
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode === 0 && child.signalCode === null) return
    throw unavailable()
  }
  await new Promise<void>((resolve, reject) => {
    const done = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(force)
      clearTimeout(timeout)
      child.off("exit", done)
      child.off("close", done)
      if (code === 0 && signal === null) resolve()
      else reject(unavailable())
    }
    const force = setTimeout(() => child.kill("SIGKILL"), 3_000)
    const timeout = setTimeout(() => {
      child.off("exit", done)
      child.off("close", done)
      reject(unavailable())
    }, 4_000)
    child.once("exit", done)
    child.once("close", done)
    child.stdin?.end()
  })
}

function unavailable(): ClaudeAccountError {
  return new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 代理不可用，请勿登录")
}
