// 用假时钟、假会话入口及临时 JSON 验证定时任务的实际触发行为。

import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { afterEach, expect, it, vi } from "vitest"
import type { ScheduledTaskOutcome } from "../../scheduled-tasks-contract"
import { deferred } from "../testing/profile-fixture"
import type { ScheduledTaskService } from "./service"
import { disposeFixtures, fixture, hour, minute, reopen } from "./service-fixture"
import { systemScheduleClock } from "./timing"

afterEach(disposeFixtures)

it("先保存任务，在第一次符合规则的时刻调用一次会话入口", async () => {
  const f = await fixture()
  await f.service.start()
  const task = await f.service.create(f.input)
  expect(task.nextRunAt).toBe("2026-11-15T08:15:00.000Z")

  f.clock.advance(14 * minute)
  await f.service.list()
  expect(f.run).not.toHaveBeenCalled()
  f.clock.advance(minute)
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce())
  expect(f.run.mock.calls[0]?.[0]).toMatchObject({
    task: { id: task.id, prompt: f.input.prompt },
    run: { source: "schedule", scheduledAt: task.nextRunAt, status: "running" },
  })
  await vi.waitFor(async () =>
    expect((await f.service.runs(task.id)).runs[0]).toMatchObject({ status: "succeeded" }),
  )
  expect(f.service.summary().next).toMatchObject({ nextRunAt: "2026-11-15T08:30:00.000Z" })
})

it("保存编辑和暂停状态，恢复时从当前时间安排未来触发", async () => {
  const f = await fixture()
  await f.service.start()
  const task = await f.service.create(f.input)
  expect(await f.service.update(task.id, { ...f.input, prompt: "改成汇总构建结果" })).toMatchObject(
    { prompt: "改成汇总构建结果", nextRunAt: task.nextRunAt },
  )
  await f.service.pauseAll()
  expect(f.service.summary()).toEqual({ next: null, enabled: [] })

  f.clock.advance(45 * minute)
  await f.service.list()
  expect(f.run).not.toHaveBeenCalled()
  const resumed = await f.service.setEnabled(task.id, true)
  expect(resumed.nextRunAt).toBe("2026-11-15T09:00:00.000Z")
  await f.service.remove(task.id)
  expect(await f.service.list()).toEqual([])
  await expect(f.service.runs(task.id)).rejects.toThrow("SCHEDULE_TASK_NOT_FOUND")
})

it("每分钟重复低于十五分钟时拒绝保存任务", async () => {
  const f = await fixture()
  await expect(
    f.service.create({
      ...f.input,
      rule: { kind: "everyMinutes", every: 14, anchor: "2026-11-15T08:00:00.000Z" },
    }),
  ).rejects.toThrow("SCHEDULE_INTERVAL_TOO_SHORT")
  expect(await f.service.list()).toEqual([])
})

it("重启合并长时间错过的触发，只补最近的一次并从现在重排", async () => {
  const f = await fixture()
  const task = await f.service.create(f.input)
  await f.service.start()
  await f.service.dispose()
  f.clock.advance(25 * hour + 7 * minute)
  const reopened = reopen(f)
  await Promise.all([reopened.start(), reopened.wake(), reopened.wake()])
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce())
  expect(f.run.mock.calls[0]?.[0].run.scheduledAt).toBe("2026-11-16T09:00:00.000Z")
  expect(reopened.summary().next?.nextRunAt).toBe("2026-11-16T09:15:00.000Z")
  expect((await reopened.runs(task.id)).total).toBe(1)
})

it.each([
  [12 * hour, null],
  [12 * hour + 1, "MISSED"],
] as const)("唤醒时以十二小时为包含边界，年龄 %d 毫秒", async (age, reason) => {
  vi.stubEnv("TZ", "UTC")
  const f = await fixture()
  const task = await f.service.create({ ...f.input, rule: { kind: "daily", time: "09:00" } })
  await f.service.start()
  expect(task.nextRunAt).toBe("2026-11-15T09:00:00.000Z")
  f.clock.wall = Date.parse("2026-11-15T09:00:00.000Z") + age
  await f.service.wake()
  const page = await f.service.runs(task.id)
  expect(page.runs[0]).toMatchObject({ reason, scheduledAt: task.nextRunAt })
  expect(f.run).toHaveBeenCalledTimes(reason === null ? 1 : 0)
  expect(f.service.summary().next?.nextRunAt).toBe("2026-11-16T09:00:00.000Z")
})

it("巡检在时区变化后按新本地时间重排未来触发", async () => {
  vi.stubEnv("TZ", "UTC")
  const f = await fixture()
  const task = await f.service.create({ ...f.input, rule: { kind: "daily", time: "09:00" } })
  await f.service.start()
  expect(task.nextRunAt).toBe("2026-11-15T09:00:00.000Z")

  vi.stubEnv("TZ", "Asia/Shanghai")
  f.clock.advance(minute)
  await f.service.list()
  expect(f.service.summary().next?.nextRunAt).toBe("2026-11-16T01:00:00.000Z")
  expect(f.run).not.toHaveBeenCalled()
})

it("切换时区时不用旧时刻补跑，新本地时刻未到就继续等待", async () => {
  vi.stubEnv("TZ", "Asia/Shanghai")
  const f = await fixture()
  f.clock.wall = Date.parse("2026-11-15T00:00:00.000Z")
  const task = await f.service.create({ ...f.input, rule: { kind: "daily", time: "09:00" } })
  await f.service.start()
  expect(task.nextRunAt).toBe("2026-11-15T01:00:00.000Z")

  vi.stubEnv("TZ", "UTC")
  f.clock.wall = Date.parse("2026-11-15T06:00:00.000Z")
  await f.service.wake()
  expect(f.run).not.toHaveBeenCalled()
  expect(f.service.summary().next?.nextRunAt).toBe("2026-11-15T09:00:00.000Z")
  expect((await f.service.runs(task.id)).total).toBe(0)
})

it("新时区已到的本地时刻可补跑，回到原时区也只认领一次同一日历时刻", async () => {
  vi.stubEnv("TZ", "UTC")
  const f = await fixture()
  f.clock.wall = Date.parse("2026-11-15T00:00:00.000Z")
  const task = await f.service.create({ ...f.input, rule: { kind: "daily", time: "09:00" } })
  await f.service.start()

  vi.stubEnv("TZ", "Asia/Shanghai")
  f.clock.wall = Date.parse("2026-11-15T02:00:00.000Z")
  await f.service.wake()
  await vi.waitFor(async () =>
    expect((await f.service.runs(task.id)).runs[0]).toMatchObject({
      status: "succeeded",
      scheduledAt: "2026-11-15T01:00:00.000Z",
    }),
  )

  vi.stubEnv("TZ", "UTC")
  f.clock.wall = Date.parse("2026-11-15T10:00:00.000Z")
  await f.service.wake()
  expect(f.run).toHaveBeenCalledOnce()
  expect((await f.service.runs(task.id)).total).toBe(1)
  expect(f.service.summary().next?.nextRunAt).toBe("2026-11-16T09:00:00.000Z")
})

it("运行时未提供 IANA 时区名时仍能保存排期并重开", async () => {
  vi.stubEnv("TZ", "UTC+3")
  const f = await fixture()
  f.clock.timeZone = systemScheduleClock.timeZone
  const task = await f.service.create(f.input)
  await f.service.start()
  await f.service.dispose()

  const reopened = reopen(f)
  await reopened.start()
  expect((await reopened.list())[0]).toMatchObject({
    id: task.id,
    nextRunAt: task.nextRunAt,
  })
})

it("按本地日历跨夏令时，并在结束时刻用完后停止排期", async () => {
  vi.stubEnv("TZ", "America/New_York")
  const f = await fixture()
  f.clock.wall = Date.parse("2026-03-08T06:00:00.000Z")
  await f.service.start()
  const task = await f.service.create({
    ...f.input,
    rule: { kind: "daily", time: "02:30" },
    endsAt: "2026-03-08T07:30:00.000Z",
  })
  expect(task.nextRunAt).toBe("2026-03-08T07:30:00.000Z")
  f.clock.advance(90 * minute)
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce())
  expect((await f.service.list())[0]?.nextRunAt).toBeNull()
  expect(f.service.summary().next).toBeNull()
})

it("墙钟倒退超过两分钟时重算，已认领的时刻经过第二次也不重复", async () => {
  vi.stubEnv("TZ", "UTC")
  const f = await fixture()
  f.clock.wall = Date.parse("2026-11-15T08:03:00.000Z")
  const task = await f.service.create({ ...f.input, rule: { kind: "daily", time: "08:00" } })
  await f.service.start()
  expect(task.nextRunAt).toBe("2026-11-16T08:00:00.000Z")
  f.clock.wall -= 10 * minute
  f.clock.advance(minute)
  await f.service.list()
  expect(f.service.summary().next?.nextRunAt).toBe("2026-11-15T08:00:00.000Z")

  f.clock.advance(6 * minute)
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce())
  f.clock.wall -= 10 * minute
  f.clock.advance(minute)
  await f.service.list()
  expect(f.service.summary().next?.nextRunAt).toBe("2026-11-16T08:00:00.000Z")
  f.clock.advance(9 * minute)
  await f.service.list()
  expect(f.run).toHaveBeenCalledOnce()
})

it("同一任务并发触发只调用一次会话，保留五十条记录且不挤掉运行中记录", async () => {
  const f = await fixture()
  const complete = deferred<ScheduledTaskOutcome>()
  f.run.mockImplementation(() => complete.promise)
  const task = await f.service.create({ ...f.input, enabled: false })
  try {
    const first = await f.service.runNow(task.id)
    expect(first).toMatchObject({ status: "running", source: "manual", scheduledAt: null })
    for (let attempt = 0; attempt < 55; attempt++) {
      f.clock.wall += 1
      expect(await f.service.runNow(task.id)).toMatchObject({
        status: "skipped",
        reason: "TASK_BUSY",
      })
    }
    expect(f.run).toHaveBeenCalledOnce()
    const page = await f.service.runs(task.id)
    expect(page.total).toBe(50)
    expect(page.runs).toContainEqual(expect.objectContaining({ id: first.id, status: "running" }))
    expect((await f.service.runs(task.id, 40, 20)).runs).toHaveLength(10)
    complete.resolve({ status: "succeeded", sessionId: "fake-session", accountId: "fake-account" })
    await vi.waitFor(async () =>
      expect((await f.service.runs(task.id)).runs).toContainEqual(
        expect.objectContaining({
          id: first.id,
          status: "succeeded",
          sessionId: "fake-session",
          accountId: "fake-account",
        }),
      ),
    )
  } finally {
    complete.resolve({ status: "stopped" })
  }
})

it("兼容旧文件并在墙钟回拨后按实际触发顺序保留最近五十条，重开后分页一致", async () => {
  const f = await fixture()
  const task = await f.service.create({ ...f.input, enabled: false })
  async function run(service: ScheduledTaskService) {
    f.clock.wall += 1_000
    f.clock.elapsed += 1_000
    const claim = await service.runNow(task.id)
    await vi.waitFor(
      async () => {
        const { runs } = await service.runs(task.id)
        expect(runs.find(({ id }) => id === claim.id)?.status).toBe("succeeded")
      },
      { interval: 2 },
    )
    return claim
  }

  const oldest = await run(f.service)
  const secondOldest = await run(f.service)
  for (let index = 2; index < 50; index += 1) await run(f.service)
  await f.service.dispose()

  const legacy = JSON.parse(await readFile(f.filePath, "utf8")) as {
    tasks: Array<{ history: Array<{ triggerSequence?: number }> }>
  }
  for (const { history } of legacy.tasks) {
    for (const record of history) delete record.triggerSequence
  }
  await writeFile(f.filePath, JSON.stringify(legacy))

  const migrated = reopen(f)
  await migrated.start()
  f.clock.wall -= 10 * minute
  const first = await run(migrated)
  const second = await run(migrated)
  expect(second.triggeredAt < oldest.triggeredAt).toBe(true)
  expect(await migrated.runs(task.id, 0, 2)).toMatchObject({
    total: 50,
    runs: [
      { id: second.id, triggerSequence: 52, triggeredAt: second.triggeredAt },
      { id: first.id, triggerSequence: 51, triggeredAt: first.triggeredAt },
    ],
  })
  const all = await migrated.runs(task.id)
  expect(all.runs.map(({ id }) => id)).not.toContain(oldest.id)
  expect(all.runs.map(({ id }) => id)).not.toContain(secondOldest.id)
  await migrated.dispose()

  const reopened = reopen(f)
  await reopened.start()
  expect(await reopened.runs(task.id)).toEqual(all)
  expect(await reopened.runs(task.id, 1, 20)).toEqual({
    total: 50,
    runs: all.runs.slice(1, 21),
  })
})

it("到点时已有一次运行就记录跳过，退出中止入口并保存最后结果", async () => {
  const f = await fixture()
  const aborted = vi.fn()
  f.run.mockImplementationOnce(
    (_request, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted()
            reject(new Error("fixture service closed"))
          },
          { once: true },
        )
      }),
  )
  const task = await f.service.create(f.input)
  const first = await f.service.runNow(task.id)
  f.clock.advance(15 * minute)
  await f.service.list()
  expect(f.run).toHaveBeenCalledOnce()
  expect((await f.service.runs(task.id)).runs[0]).toMatchObject({
    source: "schedule",
    status: "skipped",
    reason: "TASK_BUSY",
  })
  expect(f.service.summary().next?.nextRunAt).toBe("2026-11-15T08:30:00.000Z")
  await f.service.dispose()

  expect(aborted).toHaveBeenCalledOnce()
  expect((await f.service.runs(task.id)).runs).toContainEqual(
    expect.objectContaining({
      id: first.id,
      status: "stopped",
      reason: "APP_STOPPED",
    }),
  )
  f.clock.advance(2 * hour)
  expect(f.run).toHaveBeenCalledOnce()
})

it("重启把未完成的已认领运行标记为中断并保留游标", async () => {
  const f = await fixture()
  const task = await f.service.create(f.input)
  const complete = deferred<ScheduledTaskOutcome>()
  f.run.mockImplementationOnce(() => complete.promise)
  try {
    await f.service.start()
    f.clock.wall += 15 * minute
    await f.service.wake()
    expect(f.run).toHaveBeenCalledOnce()
    const snapshot = f.filePath + ".restart"
    await copyFile(f.filePath, snapshot)
    const restarted = reopen(f, snapshot)
    await restarted.start()
    expect((await restarted.runs(task.id)).runs[0]).toMatchObject({
      status: "stopped",
      reason: "APP_STOPPED",
    })
    expect(f.run).toHaveBeenCalledOnce()
  } finally {
    complete.resolve({ status: "stopped" })
  }
})

it("认领或完成记录写失败时可以重试，同一触发只交给入口一次", async () => {
  const f = await fixture()
  const task = await f.service.create(f.input)
  const complete = deferred<ScheduledTaskOutcome>()
  f.run.mockImplementationOnce(() => complete.promise)
  await f.service.start()
  const backup = f.filePath + ".backup"
  const blockWrites = async () => {
    await rename(f.filePath, backup)
    await mkdir(f.filePath)
  }
  const restore = async () => {
    await rm(f.filePath, { recursive: true })
    await rename(backup, f.filePath)
  }
  f.clock.wall += 15 * minute
  await blockWrites()
  try {
    await expect(f.service.wake()).rejects.toThrow()
    expect(f.run).not.toHaveBeenCalled()
    expect(f.service.summary().next?.nextRunAt).toBe(task.nextRunAt)
  } finally {
    await restore()
  }
  try {
    await Promise.all([f.service.wake(), f.service.wake()])
    expect(f.run).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(f.filePath, "utf8"))).toMatchObject({
      tasks: [{ active: { status: "running" } }],
    })
    await blockWrites()
    try {
      complete.resolve({ status: "failed", reason: "FIXTURE_FAILURE" })
      await vi.waitFor(() => expect(f.reportError).toHaveBeenCalled())
      expect((await f.service.runs(task.id)).runs[0]?.status).toBe("running")
    } finally {
      await restore()
    }
    await f.service.wake()
    expect((await f.service.runs(task.id)).runs[0]).toMatchObject({
      status: "failed",
      reason: "FIXTURE_FAILURE",
    })
    expect(f.run).toHaveBeenCalledOnce()
  } finally {
    complete.resolve({ status: "stopped" })
  }
})
