// 通过本次测试启动的独立子进程验证会话的进程记录、核对和回收。

import { spawn, type ChildProcess } from "node:child_process"
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, normalize } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { windowsClaudeProcessTimeoutMs } from "./claude-process-identity"
import {
  forgetRetainedClaudeProcess,
  reapRetainedClaudeProcess,
  recordRetainedClaudeProcess,
} from "./retained-claude-process"

type TestChild = { child: ChildProcess; pid: number; exited: Promise<void> }
const children: TestChild[] = []
const platformTestMs = 60_000
const childWaitMs = 5_000
let directory: string

// Windows 的每个身份读取/核验各起一次 PowerShell，同一用例可能需要多次探测。
function testBudget(probes: number): number {
  if (process.platform !== "win32") return platformTestMs
  return probes * windowsClaudeProcessTimeoutMs + 4 * childWaitMs
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-retained-process-"))
})

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.child.exitCode === null && child.child.signalCode === null)
      child.child.kill("SIGKILL")
    await waitForChild(child.exited, "测试子进程清理失败")
  }
  await rm(directory, { recursive: true, force: true })
})

async function waitForChild(pending: Promise<void>, reason: string): Promise<void> {
  const controller = new AbortController()
  try {
    await Promise.race([
      pending,
      delay(childWaitMs, undefined, { signal: controller.signal }).then(() => {
        throw new Error(reason)
      }),
    ])
  } finally {
    controller.abort()
  }
}

async function launch(): Promise<TestChild> {
  const child = spawn(
    process.execPath,
    ["-e", 'setInterval(() => {}, 10_000); process.send ? process.send("ready") : process.exit(1)'],
    { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true },
  )
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()))
  if (child.pid === undefined) {
    child.on("error", () => undefined)
    await waitForChild(exited, "测试子进程启动错误未完成")
    throw new Error("没有启动测试子进程")
  }
  const started = { child, pid: child.pid, exited }
  children.push(started)
  const ready = new Promise<void>((resolve, reject) => {
    child.once("message", (message) => {
      if (message === "ready") resolve()
      else reject(new Error("测试子进程没有发出就绪信号"))
    })
    child.once("error", reject)
    child.once("close", () => reject(new Error("测试子进程在就绪前退出")))
  })
  await waitForChild(ready, "测试子进程没有及时发出就绪信号")
  return started
}

function sidecar(): string {
  return join(directory, "claude-process.json")
}

function comparablePath(path: string): string {
  return process.platform === "win32" ? normalize(path).toLowerCase() : path
}

function fakeBirth(ordinal: number): string {
  switch (process.platform) {
    case "darwin":
      return `darwin:ff358bde-88ee-44ab-be51-5afe03829424:Sat Nov 14 20:25:0${ordinal} 2026`
    case "linux":
      return `linux:ff358bde-88ee-44ab-be51-5afe03829424:${ordinal}`
    default:
      return `win32:${ordinal}`
  }
}

describe("retained Claude process", () => {
  it(
    "records the owned child, reaps it from its identity, and removes the record",
    async () => {
      const child = await launch()

      const recorded = await recordRetainedClaudeProcess(directory, child.pid, process.execPath)
      expect(recorded?.pid).toBe(child.pid)
      const canonical = await realpath(process.execPath)
      expect(comparablePath(recorded?.executable ?? "")).toBe(comparablePath(canonical))
      expect(recorded?.startedAt).toEqual(expect.any(String))

      await reapRetainedClaudeProcess(directory)

      await waitForChild(child.exited, "回收后子进程仍在运行")
      await expect(lstat(sidecar())).rejects.toMatchObject({ code: "ENOENT" })
      await expect(reapRetainedClaudeProcess(directory)).resolves.toBeUndefined()
    },
    testBudget(2),
  )

  it(
    "leaves a child running when its PID is now owned by a different launch",
    async () => {
      const child = await launch()
      const identity = await recordRetainedClaudeProcess(directory, child.pid, process.execPath)
      if (identity === null) throw new Error("测试进程已退出")
      const anotherStart = identity.startedAt.replace(/\d$/, (digit) =>
        String((Number(digit) + 1) % 10),
      )
      await writeFile(sidecar(), JSON.stringify({ ...identity, startedAt: anotherStart }))

      await reapRetainedClaudeProcess(directory)

      expect(child.child.exitCode).toBeNull()
      expect(child.child.signalCode).toBeNull()
      await expect(lstat(sidecar())).rejects.toMatchObject({ code: "ENOENT" })
    },
    testBudget(2),
  )

  it(
    "does not accept a live PID with a different executable",
    async () => {
      const child = await launch()
      const wrongExecutable = join(directory, "not-claude")
      await writeFile(wrongExecutable, "")

      await expect(
        recordRetainedClaudeProcess(directory, child.pid, wrongExecutable),
      ).rejects.toThrow(/核对可执行文件失败/)

      expect(child.child.exitCode).toBeNull()
      expect(child.child.signalCode).toBeNull()
      await expect(lstat(sidecar())).rejects.toMatchObject({ code: "ENOENT" })
    },
    testBudget(1),
  )

  it.skipIf(process.platform !== "win32")(
    "accepts a case variant of the Windows launch path",
    async () => {
      const child = await launch()

      const identity = await recordRetainedClaudeProcess(
        directory,
        child.pid,
        process.execPath.toUpperCase(),
      )
      expect(identity?.pid).toBe(child.pid)
      const current = identity
      if (current === null) throw new Error("测试进程已退出")
      await writeFile(
        sidecar(),
        JSON.stringify({ ...current, executable: current.executable.toUpperCase() }),
      )

      await reapRetainedClaudeProcess(directory)
      await waitForChild(child.exited, "使用大小写变体回收后子进程仍在运行")
    },
    testBudget(2),
  )

  it("preserves the next process record when a late exit from the previous launch arrives", async () => {
    const previous = { pid: 234_560, executable: process.execPath, startedAt: fakeBirth(1) }
    const current = { ...previous, startedAt: fakeBirth(2) }
    await writeFile(sidecar(), JSON.stringify(current))

    await forgetRetainedClaudeProcess(directory, previous)

    expect(JSON.parse(await readFile(sidecar(), "utf8"))).toEqual(current)
    await forgetRetainedClaudeProcess(directory, current)
    await expect(lstat(sidecar())).rejects.toMatchObject({ code: "ENOENT" })
  })

  it(
    "keeps the old record intact until the previous process has been released",
    async () => {
      const first = await launch()
      const second = await launch()
      const identity = await recordRetainedClaudeProcess(directory, first.pid, process.execPath)
      if (identity === null) throw new Error("测试进程已退出")

      await expect(
        recordRetainedClaudeProcess(directory, second.pid, process.execPath),
      ).rejects.toThrow(/无法安全核对/)

      expect(JSON.parse(await readFile(sidecar(), "utf8"))).toEqual(identity)
    },
    testBudget(2),
  )

  it("keeps a malformed process record for diagnosis and declines recovery", async () => {
    await writeFile(sidecar(), '{"pid":')

    await expect(reapRetainedClaudeProcess(directory)).rejects.toThrow(/读取进程记录失败/)
    expect(await readFile(sidecar(), "utf8")).toBe('{"pid":')
  })
})
