// 验证调度入口的异常结果不会破坏已经写入磁盘的运行记录。

import { afterEach, expect, it } from "vitest"
import type { ScheduledTaskOutcome } from "../../scheduled-tasks-contract"
import { disposeFixtures, fixture, reopen } from "./service-fixture"

afterEach(disposeFixtures)

it.each([
  ...[Number.NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((deniedApprovals) => ({
    name: `非法审批次数 ${deniedApprovals}`,
    outcome: { status: "succeeded", deniedApprovals },
    expected: { status: "succeeded", deniedApprovals: 0 },
  })),
  {
    name: "非法可选字段",
    outcome: {
      status: "succeeded",
      reason: 3,
      sessionId: "fake-session",
      accountId: "",
      deniedApprovals: 2,
    },
    expected: {
      status: "succeeded",
      reason: null,
      sessionId: "fake-session",
      accountId: null,
      deniedApprovals: 2,
    },
  },
  {
    name: "入口未返回终态",
    outcome: { status: "running" },
    expected: { status: "failed", reason: "EXECUTION_FAILED" },
  },
  {
    name: "入口未返回结果对象",
    outcome: null,
    expected: { status: "failed", reason: "EXECUTION_FAILED" },
  },
  {
    name: "现场会话已处理终态通知",
    outcome: { status: "succeeded", sessionId: "fake-session", sessionNoticeHandled: true },
    expected: { status: "succeeded", sessionId: "fake-session", sessionNoticeHandled: true },
  },
])("$name 的运行结果落盘后仍能被新进程读取", async ({ outcome, expected }) => {
  const f = await fixture()
  f.run.mockResolvedValueOnce(outcome as unknown as ScheduledTaskOutcome)
  const task = await f.service.create({ ...f.input, enabled: false })
  const claim = await f.service.runNow(task.id)
  await f.service.dispose()

  const restarted = reopen(f)
  await restarted.start()
  const { runs } = await restarted.runs(task.id)
  expect(runs.find(({ id }) => id === claim.id)).toMatchObject(expected)
})
