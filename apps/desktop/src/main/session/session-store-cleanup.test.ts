// 验证会话存储打开时的清理和删除：没有索引的目录按 1 小时边界清理、残留的索引临时文件清掉、
// 删除会话删掉整个目录，模型目录查询用的 sessions/ 清理不碰新根目录，索引里没有凭据字段。

import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { cleanupStaleSessionDirs } from "./session-environment"
import { SessionStore } from "./session-store"
import { newSessionIndex, removeTemporaryDirs, temporaryDir } from "./session-store-fixtures"
import { sessionStoreRoot } from "./session-store-layout"

const now = Date.parse("2026-11-14T12:00:00.000Z")
const minute = 60_000

afterEach(removeTemporaryDirs)

async function directoryAged(root: string, name: string, ageMs: number): Promise<void> {
  const path = join(root, name)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, "partial"), "x")
  const at = new Date(now - ageMs)
  await utimes(path, at, at)
}

describe("SessionStore 清理", () => {
  it("没有索引的目录修改时间超过 1 小时才删除，不到 1 小时的留着", async () => {
    const root = join(await temporaryDir(), "session-store")
    await directoryAged(root, "orphan-old", 61 * minute)
    await directoryAged(root, "orphan-fresh", 59 * minute)

    await SessionStore.open({ root, now: () => now })

    expect((await readdir(root)).sort()).toEqual(["orphan-fresh"])
  })

  it("打开时清掉会话目录里残留的索引临时文件，索引本身不动", async () => {
    const root = join(await temporaryDir(), "session-store")
    const first = await SessionStore.open({ root })
    await first.create(newSessionIndex("s-1"))
    const { directory, indexFile } = first.paths("s-1")
    const before = await readFile(indexFile, "utf8")
    await writeFile(join(directory, ".index.json.0b5d.tmp"), '{"version":1,"tit')

    const store = await SessionStore.open({ root })

    expect(await readdir(directory)).toEqual(["index.json"])
    expect(await readFile(indexFile, "utf8")).toBe(before)
    expect(store.list()).toHaveLength(1)
  })

  it("删除会话删掉整个会话目录并移出内存索引", async () => {
    const root = join(await temporaryDir(), "session-store")
    const store = await SessionStore.open({ root })
    await store.create(newSessionIndex("s-1"))
    await store.create(newSessionIndex("s-2"))
    await mkdir(store.paths("s-1").claudeConfigDir)
    await writeFile(join(store.paths("s-1").claudeConfigDir, ".claude.json"), "{}")

    await store.delete("s-1")

    expect(await readdir(root)).toEqual(["s-2"])
    expect(store.list().map((index) => index.id)).toEqual(["s-2"])
  })

  it("Claude Code 配置目录和临时目录都在会话目录里，存储不提前创建它们", async () => {
    const root = join(await temporaryDir(), "session-store")
    const store = await SessionStore.open({ root })
    await store.create(newSessionIndex("s-1"))
    const paths = store.paths("s-1")

    expect(paths.claudeConfigDir).toBe(join(root, "s-1", "claude"))
    expect(paths.claudeTmpDir).toBe(join(root, "s-1", "tmp"))
    expect(await readdir(paths.directory)).toEqual(["index.json"])
  })

  it("模型目录查询用的 sessions/ 清理不碰会话存储根目录", async () => {
    const userData = await temporaryDir()
    const store = await SessionStore.open({ root: sessionStoreRoot(userData) })
    await store.create(newSessionIndex("s-1"))
    await mkdir(join(userData, "sessions", "stale"), { recursive: true })

    await cleanupStaleSessionDirs(userData)

    expect(await readdir(join(userData, "sessions"))).toEqual([])
    expect(await readdir(sessionStoreRoot(userData))).toEqual(["s-1"])
  })

  it("索引文件里没有代理、令牌或密码字段", async () => {
    const root = join(await temporaryDir(), "session-store")
    const store = await SessionStore.open({ root })
    await store.create(newSessionIndex("s-1"))

    const text = await readFile(store.paths("s-1").indexFile, "utf8")

    expect(text).not.toMatch(/proxy|token|password|secret|credential/i)
  })
})
