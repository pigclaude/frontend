// 为调度验证提供临时存储、可控时钟及合成会话入口。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "vitest"
import type { ScheduledTaskInput } from "../../scheduled-tasks-contract"
import { ScheduledTaskService, type ScheduleClock } from "./service"

/** 调度测试推进时间使用的毫秒单位。 */
export const minute = 60_000
/** 调度测试推进时间的一小时。 */
export const hour = 60 * minute

const directories: string[] = []
const services: ScheduledTaskService[] = []

/** 关闭夹具及临时目录，并恢复测试改过的时区。 */
export async function disposeFixtures(): Promise<void> {
  await Promise.allSettled(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  vi.unstubAllEnvs()
}

/** 创建使用合成会话入口和假时钟的本机调度服务。 */
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-tasks-"))
  directories.push(directory)
  const clock = new FakeClock(Date.parse("2026-11-15T08:00:00.000Z"))
  const run = vi.fn<ConstructorParameters<typeof ScheduledTaskService>[0]["run"]>(async () => ({
    status: "succeeded",
    sessionId: "fake-session",
  }))
  const filePath = join(directory, "scheduled-tasks.json")
  const reportError = vi.fn()
  const service = new ScheduledTaskService({ filePath, clock, run, reportError })
  services.push(service)
  const input: ScheduledTaskInput = {
    projectPath: directory,
    prompt: "汇总本机项目的测试结果",
    rule: { kind: "everyMinutes", every: 15, anchor: "2026-11-15T08:00:00.000Z" },
    endsAt: null,
    enabled: true,
    model: null,
    permissionMode: "default",
    accountId: null,
  }
  return { service, clock, run, filePath, input, reportError }
}

/** 沿用同一测试文件重开调度服务，模拟应用重启。 */
export function reopen(f: Awaited<ReturnType<typeof fixture>>, filePath = f.filePath) {
  const service = new ScheduledTaskService({ ...f, filePath })
  services.push(service)
  return service
}

class FakeClock implements ScheduleClock {
  readonly timers = new Map<() => void, number>()
  elapsed = 0

  constructor(public wall: number) {}

  now = () => this.wall
  monotonicNow = () => this.elapsed
  timeZone: ScheduleClock["timeZone"] = () => Intl.DateTimeFormat().resolvedOptions().timeZone
  after(delay: number, callback: () => void): () => void {
    this.timers.set(callback, this.elapsed + delay)
    return () => void this.timers.delete(callback)
  }

  advance(ms: number): void {
    this.wall += ms
    this.elapsed += ms
    for (const [callback, deadline] of this.timers) {
      if (deadline > this.elapsed) continue
      this.timers.delete(callback)
      callback()
    }
  }
}
