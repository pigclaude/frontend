// 验证独立合成宿主被强制结束后，其真实 Xray 本机入口也会关闭。

import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { expect, it } from "vitest"

const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(!binary)(
  "宿主被强制结束后回收真实 Xray",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-crash-"))
    const output = join(directory, "ready")
    const require = createRequire(import.meta.url)
    const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs")
    const fixture = resolve(import.meta.dirname, "xray-crash-fixture.test.ts")
    const child = spawn(
      process.execPath,
      [vitest, "run", fixture, "--pool=threads", "--maxWorkers=1"],
      {
        cwd: resolve(import.meta.dirname, "../../.."),
        env: { ...process.env, PIGCLAUDE_TEST_XRAY_READY_FILE: output },
        detached: process.platform !== "win32",
        stdio: "ignore",
      },
    )
    try {
      const url = new URL(await waitForFile(output))
      expect(await portOpen(url)).toBe(true)
      child.kill("SIGKILL")
      const deadline = Date.now() + 4_000
      while (Date.now() < deadline && (await portOpen(url))) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(await portOpen(url)).toBe(false)
    } finally {
      await stopHost(child)
      await rm(directory, { recursive: true, force: true })
    }
  },
  25_000,
)

it.skipIf(!binary || process.platform === "win32").each([
  ["守护进程", false],
  ["进程组持有者", true],
] as const)(
  "%s 被强制结束后在原端口恢复真实 Xray",
  async (_label, stopGuard) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-crash-"))
    const output = join(directory, "ready")
    const outcome = join(directory, "close-result")
    const require = createRequire(import.meta.url)
    const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs")
    const fixture = resolve(import.meta.dirname, "xray-crash-fixture.test.ts")
    const child = spawn(
      process.execPath,
      [vitest, "run", fixture, "--pool=threads", "--maxWorkers=1"],
      {
        cwd: resolve(import.meta.dirname, "../../.."),
        env: {
          ...process.env,
          PIGCLAUDE_TEST_XRAY_READY_FILE: output,
          PIGCLAUDE_TEST_XRAY_CLOSE_FILE: outcome,
        },
        detached: true,
        stdio: "ignore",
      },
    )
    try {
      const url = new URL(await waitForFile(output))
      if (child.pid === undefined) throw new Error("合成宿主未启动")
      const watchdogPid = findWatchdog(child.pid)
      const target = stopGuard ? findWatchdog(watchdogPid) : watchdogPid
      process.kill(target, "SIGKILL")
      expect(await waitForFile(outcome)).toBe("restored")
      expect(await portOpen(url)).toBe(true)
      await stopHost(child)
      await expect.poll(() => portOpen(url), { timeout: 4_000 }).toBe(false)
    } finally {
      await stopHost(child)
      await rm(directory, { recursive: true, force: true })
    }
  },
  25_000,
)

function findWatchdog(parentPid: number): number {
  const pid = Number(
    execFileSync("pgrep", ["-P", String(parentPid), "-f", "xray-watchdog.cjs"], {
      encoding: "utf8",
    }).trim(),
  )
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("找不到本轮守护进程")
  return pid
}

async function stopHost(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
    child.once("error", () => resolve())
    child.kill("SIGKILL")
  })
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8")
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error("合成宿主未启动 Xray")
}

async function portOpen(url: URL): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect(Number(url.port), url.hostname)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}
