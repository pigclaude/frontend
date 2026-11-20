// 负责验证暂停、恢复巡检和时区读取失败时的调度行为。

import { afterEach, expect, it, vi } from "vitest"
import { disposeFixtures, fixture, hour, minute, reopen } from "./service-fixture"

afterEach(disposeFixtures)

it("暂停巡检后连已经排队的计时器也不认领，联网唤醒后补最近一次", async () => {
  const f = await fixture()
  const task = await f.service.create(f.input)
  await f.service.start()
  const queued = [...f.clock.timers.keys()][0]
  if (!queued) throw new Error("缺少调度巡检")
  f.service.suspend()
  expect(f.clock.timers.size).toBe(0)

  // 模拟一个进入系统事件队列才遇到 suspend 的旧回调。
  f.clock.advance(32 * minute)
  queued()
  await f.service.update(task.id, { ...f.input, prompt: "修改仍可保存" })
  expect(f.clock.timers.size).toBe(0)
  expect(f.run).not.toHaveBeenCalled()
  expect((await f.service.runs(task.id)).total).toBe(0)

  await Promise.all([f.service.wake(), f.service.wake()])
  await vi.waitFor(async () => {
    const { runs } = await f.service.runs(task.id)
    expect(runs).toMatchObject([{ scheduledAt: "2026-11-15T08:30:00.000Z", status: "succeeded" }])
  })
  expect(f.run).toHaveBeenCalledOnce()
  expect(f.clock.timers.size).toBe(1)
})

it("服务第一次读盘时已暂停则保留待补的游标，等唤醒后再认领", async () => {
  const f = await fixture()
  const task = await f.service.create(f.input)
  f.clock.advance(20 * minute)
  const restarted = reopen(f)
  restarted.suspend()
  await restarted.start()
  expect(f.run).not.toHaveBeenCalled()
  expect(f.clock.timers.size).toBe(0)
  expect((await restarted.list())[0]?.nextRunAt).toBe(task.nextRunAt)

  await restarted.wake()
  expect(f.run).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ run: expect.objectContaining({ scheduledAt: task.nextRunAt }) }),
    expect.any(AbortSignal),
  )
})

it("时区读取失败时不按旧时区认领，下一次巡检按系统新时区重排", async () => {
  vi.stubEnv("TZ", "UTC")
  const f = await fixture()
  const task = await f.service.create({ ...f.input, rule: { kind: "daily", time: "09:00" } })
  await f.service.dispose()

  let zoneAvailable = false
  f.clock.timeZone = () => (zoneAvailable ? "America/Phoenix" : null)
  vi.stubEnv("TZ", "America/Phoenix")
  f.clock.advance(hour)
  const service = reopen(f)
  await service.start()
  expect((await service.runs(task.id)).total).toBe(0)

  zoneAvailable = true
  f.clock.advance(minute)
  expect((await service.list())[0]?.nextRunAt).toBe("2026-11-15T16:00:00.000Z")
  expect(f.run).not.toHaveBeenCalled()
})

it("启动时区读取失败后仍会在恢复时重算回拨前留下的排期", async () => {
  vi.stubEnv("TZ", "UTC")
  const f = await fixture()
  f.clock.wall = Date.parse("2026-11-19T08:00:00.000Z")
  await f.service.start()
  const task = await f.service.create({ ...f.input, rule: { kind: "daily", time: "09:00" } })
  f.clock.advance(minute)
  await f.service.list()
  await f.service.dispose()

  let zoneAvailable = false
  f.clock.timeZone = () => (zoneAvailable ? "UTC" : null)
  f.clock.wall = Date.parse("2026-11-18T08:00:00.000Z")
  const reopened = reopen(f)
  await reopened.start()

  zoneAvailable = true
  f.clock.advance(minute)
  expect((await reopened.list())[0]?.nextRunAt).toBe("2026-11-18T09:00:00.000Z")
  expect((await reopened.runs(task.id)).total).toBe(0)
})

it("时区不可读时仍按 UTC 锚点运行固定分钟间隔任务", async () => {
  vi.stubEnv("TZ", "UTC")
  const f = await fixture()
  await f.service.start()
  const interval = await f.service.create(f.input)
  const daily = await f.service.create({ ...f.input, rule: { kind: "daily", time: "08:14" } })

  f.clock.timeZone = () => null
  f.clock.advance(14.5 * minute)
  expect((await f.service.runs(daily.id)).total).toBe(0)
  f.clock.advance(0.5 * minute)
  expect((await f.service.runs(interval.id)).total).toBe(1)
  expect((await f.service.runs(daily.id)).total).toBe(0)
})
