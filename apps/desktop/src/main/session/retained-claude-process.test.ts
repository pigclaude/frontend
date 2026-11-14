// 通过本次测试启动的独立子进程验证会话的进程记录、核对和回收。

import { spawn, type ChildProcess } from "node:child_process"
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, normalize } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  forgetRetainedClaudeProcess,
  reapRetainedClaudeProcess,
  recordRetainedClaudeProcess,
} from "./retained-claude-process"

type TestChild = { child: ChildProcess; pid: number; exited: Promise<void> }
const children: TestChild[] = []
const platformTestMs = 60_000
let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-retained-process-"))
})

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.child.exitCode === null && child.child.signalCode === null)
      child.child.kill("SIGKILL")
    await child.exited
  }
  await rm(directory, { recursive: true, force: true })
})

async function launch(): Promise<TestChild> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 10_000)"], {
    stdio: "ignore",
    windowsHide: true,
  })
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()))
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
  if (child.pid === undefined) throw new Error("没有启动测试子进程")
  const started = { child, pid: child.pid, exited }
  children.push(started)
  return started
}

function sidecar(): string {
  return join(directory, "claude-process.json")
}

function comparablePath(path: string): string {
  return process.platform === "win32" ? normalize(path).toLowerCase() : path
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

      await child.exited
      await expect(lstat(sidecar())).rejects.toMatchObject({ code: "ENOENT" })
      await expect(reapRetainedClaudeProcess(directory)).resolves.toBeUndefined()
    },
    platformTestMs,
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
    platformTestMs,
  )

  it(
    "does not accept a live PID with a different executable",
    async () => {
      const child = await launch()
      const wrongExecutable = join(directory, "not-claude")
      await writeFile(wrongExecutable, "")

      await expect(
        recordRetainedClaudeProcess(directory, child.pid, wrongExecutable),
      ).rejects.toThrow(/无法安全核对/)

      expect(child.child.exitCode).toBeNull()
      expect(child.child.signalCode).toBeNull()
      await expect(lstat(sidecar())).rejects.toMatchObject({ code: "ENOENT" })
    },
    platformTestMs,
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
      await child.exited
    },
    platformTestMs,
  )

  it(
    "preserves the next process record when a late exit from the previous launch arrives",
    async () => {
      const first = await launch()
      const previous = await recordRetainedClaudeProcess(directory, first.pid, process.execPath)
      if (previous === null) throw new Error("测试进程已退出")
      await reapRetainedClaudeProcess(directory)
      await first.exited

      const second = await launch()
      const current = await recordRetainedClaudeProcess(directory, second.pid, process.execPath)
      if (current === null) throw new Error("测试进程已退出")
      await forgetRetainedClaudeProcess(directory, previous)
      expect(JSON.parse(await readFile(sidecar(), "utf8"))).toEqual(current)

      second.child.kill()
      await second.exited
      await forgetRetainedClaudeProcess(directory, current)
      await expect(lstat(sidecar())).rejects.toMatchObject({ code: "ENOENT" })
    },
    platformTestMs,
  )

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
    platformTestMs,
  )

  it("keeps a malformed process record for diagnosis and declines recovery", async () => {
    await writeFile(sidecar(), '{"pid":')

    await expect(reapRetainedClaudeProcess(directory)).rejects.toThrow(/无法安全核对/)
    expect(await readFile(sidecar(), "utf8")).toBe('{"pid":')
  })
})
