// 用已落盘的两个任务检查桌面调度与实时会员核验的并发边界。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setImmediate } from "node:timers/promises"
import { expect, it, vi } from "vitest"
import { builtinSessionDefaults } from "../../session-defaults-contract"
import { deferred } from "../testing/profile-fixture"
import { createDesktopScheduledTaskService } from "./desktop-service"

it("同时触发的任务各自核验会员，等前一次核验结束才开始下一次", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "pigclaude-scheduled-auth-"))
  const release = deferred<void>()
  const checks = vi.fn()
  const runSession = vi.fn(async () => ({ status: "succeeded" as const }))
  const service = createDesktopScheduledTaskService({
    userDataPath,
    authorization: {
      async runAuthorized<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
        checks()
        await release.promise
        return operation(new AbortController().signal)
      },
    },
    runtime: {
      hasAvailableAccount: async () => true,
      daemonBaseUrl: "http://127.0.0.1:1234",
      start: async () => undefined,
    },
    defaults: { get: async () => builtinSessionDefaults },
    usesDevProvider: false,
    runSession,
    presentation: { refreshTray: () => undefined, announce: () => false },
  })
  try {
    const config = {
      projectPath: userDataPath,
      prompt: "合成运行",
      rule: { kind: "daily", time: "09:00" } as const,
      endsAt: null,
      enabled: false,
      model: null,
      accountId: null,
      permissionMode: "default" as const,
    }
    const first = await service.create(config)
    const second = await service.create(config)
    await Promise.all([service.runNow(first.id), service.runNow(second.id)])
    await setImmediate()
    expect(checks).toHaveBeenCalledOnce()
    release.resolve()

    await vi.waitFor(() => expect(runSession).toHaveBeenCalledTimes(2))
    expect(checks).toHaveBeenCalledTimes(2)
  } finally {
    release.resolve()
    await service.dispose()
    await rm(userDataPath, { recursive: true, force: true })
  }
})
