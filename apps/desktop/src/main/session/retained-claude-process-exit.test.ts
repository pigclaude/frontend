// 通过进程记录入口验证 Linux 退出期间的核验重试，不给未确认身份的 PID 发送信号。

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { reapRetainedClaudeProcess } from "./retained-claude-process"

const proc = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<string>>(),
  readlink: vi.fn<(path: string) => Promise<string>>(),
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>()
  const intercept = (path: unknown): path is string =>
    typeof path === "string" && path.startsWith("/proc/")
  return {
    ...fs,
    readFile: (...args: Parameters<typeof fs.readFile>) =>
      intercept(args[0]) ? proc.readFile(args[0]) : fs.readFile(...args),
    readlink: (...args: Parameters<typeof fs.readlink>) =>
      intercept(args[0]) ? proc.readlink(args[0]) : fs.readlink(...args),
  }
})

const pid = 123_456
const boot = "ff358bde-88ee-44ab-be51-5afe03829424"
const identity = { pid, executable: "/fixture/claude", startedAt: `linux:${boot}:200` }
const started = `${pid} (test) S ${"0 ".repeat(18)}200`
const missing = Object.assign(new Error("proc entry disappeared"), { code: "ENOENT" })
let directory: string | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  proc.readFile.mockReset()
  proc.readlink.mockReset()
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
})

async function seed(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-retained-exit-"))
  const path = join(directory, "claude-process.json")
  await writeFile(path, JSON.stringify(identity))
  vi.spyOn(process, "platform", "get").mockReturnValue("linux")
  return path
}

it("waits for /proc disappearance after the process loses its executable during exit", async () => {
  const path = await seed()
  if (directory === undefined) throw new Error("测试会话目录未建立")
  let exiting = false
  let probes = 0
  const kill = vi.spyOn(process, "kill").mockImplementation((seen, signal) => {
    expect(seen).toBe(pid)
    if (signal === "SIGTERM") exiting = true
    if (signal === 0 && probes > 1) throw Object.assign(new Error("exited"), { code: "ESRCH" })
    return true
  })
  proc.readFile.mockImplementation(async (path) => (path.endsWith("/boot_id") ? boot : started))
  proc.readlink.mockImplementation(async () => {
    if (!exiting) return identity.executable
    probes += 1
    throw missing
  })

  await reapRetainedClaudeProcess(directory)

  expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([[pid, "SIGTERM"]])
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" })
})
