// 验证会话历史的公开行为，使用真实目录和不会启动网络进程的假会话适配器。

import { randomUUID } from "node:crypto"
import { lstat, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { deferred } from "../testing/profile-fixture"
import { SessionHost } from "./session-host"
import type { SessionEnvelope } from "./session-envelope"
import { AdapterFactory, FakeMembership, FakeUsage } from "./session-host-fixtures"
import { FakeRuntime } from "./session-runtime-fixture"
import { SessionStore } from "./session-store"
import { newSessionIndex, removeTemporaryDirs, temporaryDir } from "./session-store-fixtures"
import { ManualClock } from "./session-clock-fixture"

const opened: SessionHost[] = []
const now = Date.UTC(2026, 10, 15, 0)
const day = 24 * 60 * 60_000

afterEach(async () => {
  try {
    for (const host of opened.splice(0)) await host.dispose()
  } finally {
    await removeTemporaryDirs()
  }
})

describe("saved session library", () => {
  it("renames and archives an active session without replacing its timeline", async () => {
    const fixture = await launchHost()
    const id = randomUUID()
    await fixture.host.start({
      sessionId: id,
      workspace: fixture.userDataPath,
      permissionMode: "default",
    })
    await fixture.host.history.rename(id, "项目核对")
    await fixture.host.send(id, { text: "这条消息不得替换用户标题" })
    await fixture.host.history.archive(id, true)

    expect(fixture.host.list()).toEqual([])
    expect(fixture.host.list(true)).toMatchObject([{ sessionId: id, title: "项目核对" }])
    expect((await fixture.host.historyEvents(id, 0)).map((item) => item.event)).toContainEqual(
      expect.objectContaining({ type: "turn-started", userText: "这条消息不得替换用户标题" }),
    )
    expect(fixture.store.get(id)?.titleSource).toBe("user")

    await fixture.host.history.archive(id, false)
    expect(fixture.host.list()).toMatchObject([{ sessionId: id, title: "项目核对" }])
    expect(fixture.host.list(true)).toEqual([])
  })

  it("keeps a user rename queued just before the first message indexes its automatic title", async () => {
    const { host, store, userDataPath } = await launchHost()
    const id = randomUUID()
    await host.start({ sessionId: id, workspace: userDataPath, permissionMode: "default" })
    await host.historyEvents(id, 0)
    const update = store.update.bind(store)
    const indexTurn = vi.spyOn(store, "update").mockImplementationOnce((sessionId, patch) => {
      const rename = update(sessionId, { title: "自定标题", titleSource: "user" })
      const turn = update(sessionId, patch)
      return rename.then(() => turn)
    })

    await host.send(id, { text: "第一条消息的自动标题" })
    await host.historyEvents(id, 0)

    expect(indexTurn).toHaveBeenCalled()
    expect(store.get(id)).toMatchObject({ title: "自定标题", titleSource: "user" })
  })

  it("stops the session before removing both of its histories and reports disk usage", async () => {
    const fixture = await launchHost()
    const id = randomUUID()
    await fixture.host.start({
      sessionId: id,
      workspace: fixture.userDataPath,
      permissionMode: "default",
    })
    const paths = fixture.store.paths(id)
    await writeFile(join(paths.claudeConfigDir, "transcript.jsonl"), "fixture history\n")
    await writeFile(join(paths.claudeTmpDir, "temporary"), "fixture output\n")

    expect(await fixture.host.history.stats()).toMatchObject({
      count: 1,
      bytes: expect.any(Number),
    })
    expect((await fixture.host.history.stats()).bytes).toBeGreaterThan(31)
    await fixture.host.history.delete(id)
    expect(fixture.adapters.last.stops).toBe(1)
    await expect(lstat(paths.directory)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await fixture.host.history.stats()).toEqual({ count: 0, bytes: 0 })
    await expect(fixture.host.historyEvents(id, 0)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    })
    expect(fixture.host.list()).toEqual([])
  })

  it("keeps sessions by default and automatically deletes only stopped sessions older than the chosen days", async () => {
    const { host, store, userDataPath, clock } = await launchHost()
    const removals: Array<{ envelope: SessionEnvelope; indexPresent: boolean }> = []
    host.subscribe((envelope) => {
      if (envelope.event.type === "sessions-changed" && envelope.event.removed !== undefined) {
        removals.push({
          envelope,
          indexPresent: store.get(envelope.event.removed.sessionId) !== null,
        })
      }
    })
    const active = randomUUID()
    await host.start({ sessionId: active, workspace: userDataPath, permissionMode: "default" })
    await store.update(active, { lastActivityAt: new Date(now - 12 * day).toISOString() })
    for (const [id, time] of [
      ["old", now - 12 * day],
      ["boundary", now - 7 * day],
    ] as const) {
      await store.create(newSessionIndex(id, { lastActivityAt: new Date(time).toISOString() }))
    }
    await expect(host.history.retention()).resolves.toEqual({ days: null })
    await host.history.sweep()
    expect(store.list()).toHaveLength(3)

    await expect(host.history.setRetention(7)).resolves.toEqual({ days: 7 })
    expect(store.list().map((item) => item.id)).toEqual([active, "boundary"])
    expect(removals).toMatchObject([
      {
        indexPresent: false,
        envelope: {
          sessionId: null,
          seq: null,
          event: {
            type: "sessions-changed",
            removed: { sessionId: "old", projectPath: "/Users/example/project" },
          },
        },
      },
    ])
    clock.advance(day)
    await host.history.sweep()
    expect(store.list().map((item) => item.id)).toEqual([active])
    expect(removals[1]?.envelope.event).toMatchObject({ removed: { sessionId: "boundary" } })

    await host.history.setRetention(null)
    await host.history.clear()
    expect(store.list()).toEqual([])
    expect(host.list()).toEqual([])
    await expect(lstat(store.paths(active).directory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("applies the saved retention setting again when the desktop restarts", async () => {
    const { host, userDataPath, store } = await launchHost()
    await host.history.setRetention(7)
    await host.dispose()
    await store.create(
      newSessionIndex("expired", {
        lastActivityAt: new Date(now - 8 * day).toISOString(),
      }),
    )

    const reopened = await launchHost(userDataPath)
    await expect(reopened.host.history.retention()).resolves.toEqual({ days: 7 })
    await reopened.host.history.sweep()
    expect(reopened.store.list()).toEqual([])
    await expect(lstat(store.paths("expired").directory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("keeps a session used while an earlier expired session is being deleted", async () => {
    const { host, store } = await launchHost()
    const old = new Date(now - 12 * day).toISOString()
    await store.create(newSessionIndex("first", { lastActivityAt: old }))
    await store.create(newSessionIndex("second", { lastActivityAt: old }))
    const entered = deferred<void>()
    const release = deferred<void>()
    const remove = store.delete.bind(store)
    vi.spyOn(store, "delete").mockImplementation(async (id) => {
      if (id === "first") {
        entered.resolve()
        await release.promise
      }
      await remove(id)
    })

    const sweep = host.history.setRetention(7)
    try {
      await entered.promise
      await store.update("second", { lastActivityAt: new Date(now).toISOString() })
    } finally {
      release.resolve()
      await sweep
    }
    expect(store.list().map(({ id }) => id)).toEqual(["second"])
  })
})

async function launchHost(existingPath?: string) {
  const userDataPath = existingPath ?? (await temporaryDir())
  const root = join(userDataPath, "session-store")
  await mkdir(root, { recursive: true })
  const clock = new ManualClock(now)
  const store = await SessionStore.open({ root, now: clock.now })
  const adapters = new AdapterFactory([])
  const host = new SessionHost({
    membership: new FakeMembership(),
    runtime: new FakeRuntime(),
    usage: new FakeUsage(),
    userDataPath,
    resolveBinaryPath: () => join(userDataPath, "fixture-claude"),
    resolveProfile: async () => ({ timezone: "Asia/Shanghai", locale: "zh-CN" }),
    createAdapter: adapters.create,
    sessionStore: Promise.resolve(store),
    now: clock.now,
    timers: clock.timers,
  })
  opened.push(host)
  await host.ready()
  return { userDataPath, host, store, adapters, clock }
}
