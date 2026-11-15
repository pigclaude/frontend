// 验证真实回合事件控制唤醒请求，多会话共享一个请求，手动偏好重启后仍会应用。

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import { expect, it, vi } from "vitest"
import { KeepAwake, registerKeepAwakeIpc } from "./keep-awake"
import { createHarness, waitUntil } from "./session/session-host-fixtures"
import type { AdapterEvent } from "./session/session-events"
import { shutdownDesktopResources } from "./shutdown-resources"
import { deferred } from "./testing/profile-fixture"

const completed: AdapterEvent = {
  type: "result",
  subtype: "success",
  isError: false,
  durationMs: 100,
  numTurns: 1,
  stopReason: "end_turn",
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 },
}

it("最后一个会话的后台任务完成后才释放阻止空闲睡眠的请求", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pigclaude-awake-turns-"))
  const blocker = { start: vi.fn(() => 0), stop: vi.fn() }
  const awake = new KeepAwake(join(workspace, "keep-awake.json"), blocker)
  const { host, adapters } = createHarness({ workspace })
  const unsubscribe = host.subscribe((event) => awake.observe(event))
  awake.ready()
  try {
    const first = await host.start({ workspace, permissionMode: "default" })
    const second = await host.start({ workspace, permissionMode: "default" })
    expect(blocker.start).not.toHaveBeenCalled()

    await host.send(first.sessionId, { text: "first" })
    await host.send(second.sessionId, { text: "second" })
    expect(blocker.start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension")
    await awake.setEnabled(true)
    await awake.setEnabled(false)
    expect(blocker.start).toHaveBeenCalledTimes(1)
    expect(blocker.stop).not.toHaveBeenCalled()

    adapters.instances[0]?.emit({
      type: "background-tasks",
      taskIds: ["background-agent"],
      ambientTaskIds: [],
    })
    adapters.instances[0]?.emit(completed)
    adapters.instances[1]?.emit(completed)
    await waitUntil(() => host.status(second.sessionId).turnId === null)
    expect(host.status(first.sessionId).turnId).not.toBeNull()
    expect(blocker.stop).not.toHaveBeenCalled()

    adapters.instances[0]?.emit({ type: "background-tasks", taskIds: [], ambientTaskIds: [] })
    adapters.instances[0]?.emit(completed)
    await waitUntil(() => host.status(first.sessionId).turnId === null)
    expect(blocker.stop).toHaveBeenCalledExactlyOnceWith(0)
  } finally {
    unsubscribe()
    awake.dispose()
    await host.dispose()
    await rm(workspace, { recursive: true, force: true })
  }
})

it.each([false, true])("退出中保持已有唤醒请求，清理失败=%s", async (fails) => {
  const workspace = await mkdtemp(join(tmpdir(), "pigclaude-awake-shutdown-"))
  const released = vi.fn()
  const blocker = { start: vi.fn(() => 7), stop: released }
  const awake = new KeepAwake(join(workspace, "keep-awake.json"), blocker)
  const waiting = deferred<void>()
  const sessionId = "session"
  const turnId = "turn"
  try {
    awake.ready()
    awake.observe({ sessionId, event: { type: "turn-started", turnId } })
    const shutdown = shutdownDesktopResources({
      stopBackgroundWork: () => awake.holdForShutdown(),
      sessions: async () => {
        awake.observe({
          sessionId,
          event: { type: "turn-ended", turnId, status: "interrupted", errorCode: null },
        })
      },
      xray: async () => undefined,
      callback: async () => {
        await waiting.promise
        if (fails) throw new Error("合成清理失败")
      },
      releaseAwake: () => awake.dispose(),
    })
    try {
      expect(released).not.toHaveBeenCalled()
    } finally {
      waiting.resolve()
    }
    if (fails) {
      await expect(shutdown).rejects.toThrow("合成清理失败")
      expect(released).not.toHaveBeenCalled()
      awake.resumeAfterFailedShutdown()
    } else {
      await shutdown
    }
    expect(released).toHaveBeenCalledExactlyOnceWith(7)
  } finally {
    awake.dispose()
    await rm(workspace, { recursive: true, force: true })
  }
})

it("默认关闭，手动打开和关闭都在重启后保持，实际退出会释放请求", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-awake-settings-"))
  const file = join(dir, "keep-awake.json")
  const blocker = { start: vi.fn(() => 3), stop: vi.fn() }
  const first = new KeepAwake(file, blocker)
  let second: KeepAwake | undefined
  try {
    await writeFile(file, "{坏文件")
    const invalid = new KeepAwake(file, blocker)
    expect(invalid.enabled()).toBe(false)
    invalid.dispose()
    first.ready()
    expect(first.enabled()).toBe(false)
    expect(blocker.start).not.toHaveBeenCalled()
    await expect(first.setEnabled(true)).resolves.toBe(true)
    expect(blocker.start).toHaveBeenCalledTimes(1)
    first.dispose()
    expect(blocker.stop).toHaveBeenCalledExactlyOnceWith(3)

    second = new KeepAwake(file, blocker)
    second.ready()
    expect(second.enabled()).toBe(true)
    expect(blocker.start).toHaveBeenCalledTimes(2)
    second.observe({ sessionId: "session", event: { type: "turn-started", turnId: "turn" } })
    second.observe({
      sessionId: "session",
      event: { type: "turn-ended", turnId: "turn", status: "completed", errorCode: null },
    })
    expect(blocker.stop).toHaveBeenCalledTimes(1)
    await expect(second.setEnabled(false)).resolves.toBe(false)
    expect(blocker.stop).toHaveBeenCalledTimes(2)
    expect(new KeepAwake(file, blocker).enabled()).toBe(false)
  } finally {
    first.dispose()
    second?.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

it("只允许可信设置页传入布尔唤醒偏好", async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => unknown>()
  const sender = {} as IpcMainInvokeEvent
  const settings = { enabled: () => false, setEnabled: vi.fn().mockResolvedValue(true) }
  registerKeepAwakeIpc(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler)
      },
    },
    settings,
    (event) => event === sender,
  )
  const get = handlers.get("pigclaude:keep-awake-get")
  const set = handlers.get("pigclaude:keep-awake-set")
  if (!get || !set) throw new Error("缺少唤醒设置入口")
  expect(get(sender)).toBe(false)
  expect(() => get({} as IpcMainInvokeEvent)).toThrow("UNTRUSTED_KEEP_AWAKE_REQUEST")
  await expect(set({} as IpcMainInvokeEvent, true)).rejects.toThrow("UNTRUSTED_KEEP_AWAKE_REQUEST")
  await expect(set(sender, "true")).rejects.toThrow("KEEP_AWAKE_SETTINGS_INVALID")
  expect(settings.setEnabled).not.toHaveBeenCalled()
  await expect(set(sender, true)).resolves.toBe(true)
  expect(settings.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
})
