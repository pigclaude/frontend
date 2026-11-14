// 验证主进程启动时打开会话存储：打开时完成扫描和启动收敛，打开失败只记日志、不阻止启动。

import { afterEach, describe, expect, it } from "vitest"
import { SessionStore } from "./session-store"
import { newSessionIndex, removeTemporaryDirs, temporaryDir } from "./session-store-fixtures"
import { sessionStoreRoot } from "./session-store-layout"
import { startedSessionStore, startSessionStore } from "./session-store-startup"

afterEach(removeTemporaryDirs)

describe("startSessionStore", () => {
  it("在 userData 下打开会话存储，启动时就把运行中的会话收敛好", async () => {
    const userData = await temporaryDir()
    const seeded = await SessionStore.open({ root: sessionStoreRoot(userData) })
    await seeded.create(newSessionIndex("s-1", { status: "running" }))

    const store = await startSessionStore(userData, { log: () => undefined })

    expect(store?.list()).toMatchObject([{ id: "s-1", status: "parked" }])
    expect(await startedSessionStore()).toBe(store)
  })

  it("打开失败时只记日志并给出 null", async () => {
    const logs: string[] = []

    const store = await startSessionStore("/unused", {
      open: () => Promise.reject(new Error("磁盘不可用")),
      log: (message) => logs.push(message),
    })

    expect(store).toBeNull()
    expect(await startedSessionStore()).toBeNull()
    expect(logs).toEqual([expect.stringContaining("磁盘不可用")])
  })
})
