// 在注入的 SDK 查询边界启动本次测试自己的子进程，验证身份落盘与会话结束的顺序。

import { randomUUID } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { SpawnedProcess } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, describe, expect, it } from "vitest"
import { ClaudeAgentAdapter, type AdapterEvent } from "./claude-agent-adapter"
import { FakeQuery, startOptions } from "./claude-agent-adapter-fixtures"
import type { ClaudeAgentStartOptions } from "./claude-query-options"
import { isPlainRecord } from "./session-store-guards"

// 一次 Windows 身份读取有 45 秒期限，额外留给 SDK 关闭和实际子进程退出。
const spawnTestMs = process.platform === "win32" ? 75_000 : 60_000

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("测试进程未在期限内结束指定步骤")
    await delay(10)
  }
}

// 只响应自己的 stdin，能够把 fake SDK 消息流终止与真正子进程退出分开。
const childProgram = `
  const steady = setInterval(() => {}, 1000)
  process.stdin.on("data", () => {
    clearInterval(steady)
    process.stdin.pause()
  })
  process.stdin.resume()
`

type Scenario = {
  directory: string
  sidecar: string
  adapter: ClaudeAgentAdapter
  options: ClaudeAgentStartOptions
  query: FakeQuery
  pid: () => number | undefined
  stopChild: () => Promise<void>
  exited: () => boolean
  endedWhenExited: boolean[]
}

const scenarios: Scenario[] = []

afterEach(async () => {
  for (const scenario of scenarios.splice(0)) {
    await scenario.stopChild()
    await scenario.adapter.stop().catch(() => undefined)
    await rm(scenario.directory, { recursive: true, force: true })
  }
})

async function scenario(): Promise<Scenario> {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-retained-sdk-"))
  const sidecar = join(directory, "claude-process.json")
  const query = new FakeQuery()
  const endedWhenExited: boolean[] = []
  let child: SpawnedProcess | null = null
  let childExit = Promise.resolve()
  const exited = (): boolean =>
    child !== null && (child.exitCode !== null || child.signalCode != null)
  const adapter = new ClaudeAgentAdapter({
    queryFn: ({ options }) => {
      const spawn = options.spawnClaudeCodeProcess
      if (spawn === undefined) throw new Error("会话没有安装进程记录回调")
      child = spawn({
        command: process.execPath,
        args: ["-e", childProgram],
        cwd: directory,
        env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {},
        signal: options.abortController?.signal ?? new AbortController().signal,
      })
      const launched = child
      childExit = new Promise<void>((resolve) => {
        launched.once("exit", () => resolve())
        launched.once("error", () => {
          if (!("pid" in launched) || launched.pid === undefined) resolve()
        })
      })
      return query
    },
    onEvent: (event: AdapterEvent) => {
      if (event.type === "ended") endedWhenExited.push(exited())
    },
  })
  const options: ClaudeAgentStartOptions = {
    ...startOptions(),
    workspace: directory,
    binaryPath: process.execPath,
    persistence: { directory, sessionId: randomUUID(), resume: false },
  }
  const fixture: Scenario = {
    directory,
    sidecar,
    adapter,
    options,
    query,
    pid: () =>
      child !== null && "pid" in child && typeof child.pid === "number" ? child.pid : undefined,
    stopChild: async () => {
      if (child !== null && !exited()) child.kill("SIGKILL")
      const controller = new AbortController()
      try {
        await Promise.race([
          childExit,
          delay(5_000, undefined, { signal: controller.signal }).then(() => {
            throw new Error("测试子进程收到终止信号后未及时退出")
          }),
        ])
      } finally {
        controller.abort()
      }
    },
    exited,
    endedWhenExited,
  }
  scenarios.push(fixture)
  return fixture
}

describe("ClaudeAgentAdapter retained process lifecycle", () => {
  it(
    "records the CLI process before startup completes and keeps it until the query's child exits",
    async () => {
      const fixture = await scenario()
      await fixture.adapter.start(fixture.options)
      const recorded: unknown = JSON.parse(await readFile(fixture.sidecar, "utf8"))
      expect(isPlainRecord(recorded) ? recorded.pid : null).toBe(fixture.pid())
      expect(fixture.exited()).toBe(false)

      // SDK 故障时查询先出错，随后关闭由适配器拥有的子进程。
      fixture.query.fail(new Error("synthetic SDK query failure"))
      await waitFor(() => fixture.query.closes > 0, 15_000)
      if (!fixture.exited()) {
        expect(fixture.endedWhenExited).toEqual([])
        await expect(lstat(fixture.sidecar)).resolves.toBeDefined()
        await fixture.stopChild()
      }
      await waitFor(() => fixture.endedWhenExited.length > 0, 15_000)
      expect(fixture.endedWhenExited).toEqual([true])
      await fixture.adapter.stop()
      await expect(lstat(fixture.sidecar)).rejects.toMatchObject({ code: "ENOENT" })
    },
    spawnTestMs,
  )

  it(
    "closes an owned child before broadcasting startup failure when identity cannot be recorded",
    async () => {
      const fixture = await scenario()
      await mkdir(fixture.sidecar)

      const failed = fixture.adapter.start(fixture.options)
      let settled = false
      void failed
        .finally(() => {
          settled = true
        })
        .catch(() => undefined)
      await waitFor(() => fixture.query.closes > 0 || settled, 50_000)
      expect(fixture.query.closes).toBe(1)
      if (!fixture.exited()) {
        expect(fixture.endedWhenExited).toEqual([])
        await fixture.stopChild()
      }
      await expect(failed).rejects.toThrow(/无法安全核对/)
      expect(fixture.endedWhenExited).toEqual([true])
      expect((await lstat(fixture.sidecar)).isDirectory()).toBe(true)
    },
    spawnTestMs,
  )
})
