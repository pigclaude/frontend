// 验证睡眠到恢复联网期间不认领排期，重新唤醒后只补跑一次。

import { afterEach, expect, it, vi } from "vitest"
import { disposeFixtures, fixture, minute, reopen } from "./service-fixture"

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
