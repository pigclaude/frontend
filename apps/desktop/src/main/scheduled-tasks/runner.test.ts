// 验证真实调度入口在创建会话之前按顺序检查条件，以及超时和退出如何阻止后续操作。

import { afterEach, expect, it, vi } from "vitest"
import type { ScheduledTaskInput } from "../../scheduled-tasks-contract"
import { deferred } from "../testing/profile-fixture"
import { createScheduledTaskRunner } from "./runner"

const task: ScheduledTaskInput = {
  projectPath: "/fixture",
  prompt: "汇总合成构建日志",
  rule: { kind: "daily", time: "15:00" },
  endsAt: null,
  enabled: true,
  model: null,
  permissionMode: "acceptEdits",
  accountId: "preferred-account",
}

function fixture() {
  const steps: string[] = []
  const pass = (step: string) =>
    vi.fn(async () => {
      steps.push(step)
      return true
    })
  const checkMembership = pass("membership")
  const checkProject = pass("project")
  const checkAccount = pass("account")
  const startDaemon = pass("daemon")
  const runSession = vi.fn(async () => {
    steps.push("session")
    return { status: "succeeded" as const, sessionId: "local-session", accountId: "fallback" }
  })
  const defaultModel = vi.fn(async () => "configured-default")
  const operations = {
    checkMembership,
    checkProject,
    checkAccount,
    startDaemon,
    defaultModel,
    runSession,
  }
  const run = createScheduledTaskRunner(operations)
  const controller = new AbortController()
  return {
    ...operations,
    controller,
    steps,
    start: (input: ScheduledTaskInput = task) => run(input, controller.signal),
  }
}

afterEach(() => vi.useRealTimers())

it("按顺序检查后开会话，跟随默认模型并记录会话实际选中的账号", async () => {
  const f = fixture()
  await expect(f.start()).resolves.toEqual({
    status: "succeeded",
    sessionId: "local-session",
    accountId: "fallback",
  })
  expect(f.steps).toEqual(["membership", "project", "account", "daemon", "session"])
  expect(f.checkProject).toHaveBeenCalledExactlyOnceWith(task.projectPath)
  expect(f.runSession).toHaveBeenCalledExactlyOnceWith(
    { ...task, model: "configured-default" },
    f.controller.signal,
  )
})

it("保留任务指定的模型", async () => {
  const f = fixture()
  await f.start({ ...task, model: "explicit-model" })
  expect(f.defaultModel).not.toHaveBeenCalled()
  expect(f.runSession).toHaveBeenCalledExactlyOnceWith(
    { ...task, model: "explicit-model" },
    f.controller.signal,
  )
})

it.each([
  ["checkMembership", "MEMBERSHIP_REQUIRED", []],
  ["checkProject", "PROJECT_UNAVAILABLE", ["membership"]],
  ["checkAccount", "NO_AVAILABLE_ACCOUNT", ["membership", "project"]],
  ["startDaemon", "DAEMON_UNAVAILABLE", ["membership", "project", "account"]],
] as const)("条件 %s 不成立时记录跳过并停止检查", async (operation, reason, steps) => {
  const f = fixture()
  f[operation].mockResolvedValueOnce(false)

  await expect(f.start()).resolves.toEqual({ status: "skipped", reason })
  expect(f.steps).toEqual(steps)
  expect(f.runSession).not.toHaveBeenCalled()
})

it("等待 daemon 最多两分钟，迟到的就绪也不创建会话", async () => {
  vi.useFakeTimers()
  const f = fixture()
  const ready = deferred<boolean>()
  f.startDaemon.mockReturnValueOnce(ready.promise)

  const scheduled = f.start()
  await vi.advanceTimersByTimeAsync(119_999)
  expect(f.startDaemon).toHaveBeenCalledOnce()
  expect(f.runSession).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await expect(scheduled).resolves.toEqual({ status: "skipped", reason: "DAEMON_UNAVAILABLE" })
  ready.resolve(true)
  expect(f.runSession).not.toHaveBeenCalled()
})

it("退出可以立刻结束等待，迟到的核验不能继续执行", async () => {
  const f = fixture()
  const online = deferred<boolean>()
  f.checkMembership.mockReturnValueOnce(online.promise)
  const scheduled = f.start()
  await vi.waitFor(() => expect(f.checkMembership).toHaveBeenCalledOnce())

  f.controller.abort()
  await expect(scheduled).resolves.toEqual({ status: "stopped", reason: "APP_STOPPED" })
  online.resolve(true)
  expect(f.checkProject).not.toHaveBeenCalled()
  expect(f.runSession).not.toHaveBeenCalled()
})
