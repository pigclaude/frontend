// 验证会话存储的目录与索引：权限位、启动扫描建内存索引、原子写、保留不认识的字段和格式版本。

import { chmod, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SessionStore } from "./session-store"
import {
  modeOf,
  newSessionIndex,
  removeTemporaryDirs,
  temporaryDir,
} from "./session-store-fixtures"

const posixOnly = it.skipIf(process.platform === "win32")

afterEach(removeTemporaryDirs)

describe("SessionStore 索引", () => {
  it("新建会话写出第一份索引，重新打开时扫描目录建内存索引", async () => {
    const root = join(await temporaryDir(), "session-store")
    const store = await SessionStore.open({ root })

    const created = await store.create(newSessionIndex("s-1"))

    expect(created.timelineCursor).toBe(0)
    const reopened = await SessionStore.open({ root })
    expect(reopened.list()).toEqual([created])
  })

  posixOnly("根目录和会话目录是 0700，索引文件是 0600", async () => {
    const root = join(await temporaryDir(), "session-store")
    const store = await SessionStore.open({ root })
    await store.create(newSessionIndex("s-1"))
    const paths = store.paths("s-1")

    expect(await modeOf(root)).toBe(0o700)
    expect(await modeOf(paths.directory)).toBe(0o700)
    expect(await modeOf(paths.indexFile)).toBe(0o600)
    expect(JSON.parse(await readFile(paths.indexFile, "utf8"))).toMatchObject({ version: 1 })
  })

  it("局部更新索引时保留不认识的字段", async () => {
    const root = join(await temporaryDir(), "session-store")
    const first = await SessionStore.open({ root })
    await first.create(newSessionIndex("s-1"))
    const indexFile = first.paths("s-1").indexFile
    const onDisk = JSON.parse(await readFile(indexFile, "utf8")) as Record<string, unknown>
    await writeFile(indexFile, JSON.stringify({ ...onDisk, futureField: { kept: true } }))
    const store = await SessionStore.open({ root })

    const updated = await store.update("s-1", { title: "新标题", titleSource: "user" })

    expect(updated).toMatchObject({
      title: "新标题",
      titleSource: "user",
      model: "claude-sonnet-4-5",
    })
    expect(JSON.parse(await readFile(indexFile, "utf8"))).toMatchObject({
      version: 1,
      title: "新标题",
      futureField: { kept: true },
    })
  })

  it("同一会话同时发起的几次更新都写进索引", async () => {
    const root = join(await temporaryDir(), "session-store")
    const store = await SessionStore.open({ root })
    await store.create(newSessionIndex("s-1"))

    await Promise.all([
      store.update("s-1", { title: "新标题" }),
      store.update("s-1", { model: "claude-opus-4-1" }),
      store.update("s-1", { archivedAt: "2026-11-14T09:00:00.000Z" }),
    ])

    const reopened = await SessionStore.open({ root })
    expect(reopened.list()[0]).toMatchObject({
      title: "新标题",
      model: "claude-opus-4-1",
      archivedAt: "2026-11-14T09:00:00.000Z",
    })
  })

  it("格式版本更新或解析不了的索引不进内存索引，文件不改写也不删除，并记日志", async () => {
    const root = join(await temporaryDir(), "session-store")
    const first = await SessionStore.open({ root })
    await first.create(newSessionIndex("s-new"))
    await first.create(newSessionIndex("s-bad"))
    await first.create(newSessionIndex("s-ok"))
    const newer = first.paths("s-new").indexFile
    const broken = first.paths("s-bad").indexFile
    const newerText = JSON.stringify({ version: 2, id: "s-new" })
    await writeFile(newer, newerText)
    await writeFile(broken, '{"version":1,')
    const logs: string[] = []

    const store = await SessionStore.open({ root, log: (message) => logs.push(message) })

    expect(store.list().map((index) => index.id)).toEqual(["s-ok"])
    expect(await readFile(newer, "utf8")).toBe(newerText)
    expect(await readFile(broken, "utf8")).toBe('{"version":1,')
    expect(logs).toHaveLength(2)
    expect(logs.join("\n")).toMatch(/s-new/)
    expect(logs.join("\n")).toMatch(/s-bad/)
  })

  posixOnly("索引写入失败时原文件不变，也不留临时文件", async () => {
    const root = join(await temporaryDir(), "session-store")
    const store = await SessionStore.open({ root })
    await store.create(newSessionIndex("s-1"))
    const { directory, indexFile } = store.paths("s-1")
    const before = await readFile(indexFile, "utf8")
    await chmod(directory, 0o500)

    try {
      await expect(store.update("s-1", { title: "写不进去" })).rejects.toThrow()
    } finally {
      await chmod(directory, 0o700)
    }

    expect(await readFile(indexFile, "utf8")).toBe(before)
    expect(await readdir(directory)).toEqual(["index.json"])
    expect(store.list()[0]?.title).toBe("整理发布清单")
  })

  it("更新不存在的会话时报会话不存在", async () => {
    const store = await SessionStore.open({ root: join(await temporaryDir(), "session-store") })

    await expect(store.update("missing", { title: "x" })).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    })
  })
})
