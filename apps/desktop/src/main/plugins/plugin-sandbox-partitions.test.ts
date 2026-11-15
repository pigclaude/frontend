// 验证内存分区只有在清理成功后才交回同一插件版本和出口。

import { expect, it, vi } from "vitest"
import { deferred } from "../testing/profile-fixture"
import { PluginSandboxPartitions } from "./plugin-sandbox-partitions"

const signal = new AbortController().signal

it("等待本出口清理后复用分区，同时允许另一出口使用独立分区", async () => {
  const reset = deferred<void>()
  const create = vi.fn(() => ({}))
  const clean = vi.fn(() => reset.promise)
  const partitions = new PluginSandboxPartitions(create, clean)
  const first = await partitions.acquire("plugin-version-route-a", signal)
  const releasing = first.release()
  const waiting = partitions.acquire("plugin-version-route-a", signal)
  const resumed = vi.fn()
  void waiting.then(resumed, resumed)
  const other = await partitions.acquire("plugin-version-route-b", signal)

  expect(other.profile).not.toBe(first.profile)
  expect(create).toHaveBeenCalledTimes(2)
  expect(resumed).not.toHaveBeenCalled()

  reset.resolve()
  await releasing
  const reused = await waiting
  expect(reused.profile).toBe(first.profile)
  expect(first.release()).toBe(releasing)
  await Promise.all([reused.release(), other.release()])
  expect(clean).toHaveBeenCalledTimes(3)
})

it("清理失败的分区不会交回同一键，下一次使用新分区", async () => {
  const create = vi.fn(() => ({}))
  const clean = vi
    .fn<(_profile: object) => Promise<void>>()
    .mockRejectedValueOnce(new Error("fixture cleanup failed"))
    .mockResolvedValue(undefined)
  const partitions = new PluginSandboxPartitions(create, clean)
  const broken = await partitions.acquire("plugin-version-route", signal)
  await expect(broken.release()).rejects.toThrow("fixture cleanup failed")

  const fresh = await partitions.acquire("plugin-version-route", signal)
  expect(fresh.profile).not.toBe(broken.profile)
  await fresh.release()
  const reused = await partitions.acquire("plugin-version-route", signal)
  expect(reused.profile).toBe(fresh.profile)
  expect(create).toHaveBeenCalledTimes(2)
  await reused.release()
})

it("等待期间取消的调用不会占用清理后的分区", async () => {
  const reset = deferred<void>()
  const create = vi.fn(() => ({}))
  const partitions = new PluginSandboxPartitions(create, () => reset.promise)
  const first = await partitions.acquire("plugin-version-route", signal)
  await expect(partitions.acquire("plugin-version-route", signal)).rejects.toThrow(
    "PLUGIN_SANDBOX_UNAVAILABLE",
  )
  const released = first.release()
  const abort = new AbortController()
  const waiting = partitions.acquire("plugin-version-route", abort.signal)
  abort.abort()
  reset.resolve()
  await released

  await expect(waiting).rejects.toThrow("PLUGIN_CANCELLED")
  const reused = await partitions.acquire("plugin-version-route", signal)
  expect(reused.profile).toBe(first.profile)
  expect(create).toHaveBeenCalledOnce()
  await reused.release()
})
