// 负责验证最近工作区文件：只存绝对路径、最新在前、去重、最多 10 条、损坏文件回到空列表且不写入其他字段。

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WorkspaceStore } from "./workspace-store"

let directory: string
let filePath: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-workspaces-"))
  filePath = join(directory, "workspaces.json")
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("workspace store", () => {
  it("starts empty when the file does not exist", async () => {
    const store = new WorkspaceStore({ filePath })
    await expect(store.list()).resolves.toEqual([])
  })

  it("keeps the newest path first and removes duplicates", async () => {
    const store = new WorkspaceStore({ filePath })

    await store.add("/Users/me/beta")
    await store.add("/Users/me/alpha")
    await store.add("/Users/me/beta")

    await expect(store.list()).resolves.toEqual(["/Users/me/beta", "/Users/me/alpha"])
  })

  it("stores at most ten paths and only stores paths", async () => {
    const store = new WorkspaceStore({ filePath })
    for (let index = 0; index < 12; index += 1) {
      await store.add(`/Users/me/project-${index}`)
    }

    const paths = await store.list()
    expect(paths).toHaveLength(10)
    expect(paths[0]).toBe("/Users/me/project-11")
    expect(paths[9]).toBe("/Users/me/project-2")

    const raw: unknown = JSON.parse(await readFile(filePath, "utf8"))
    expect(Array.isArray(raw)).toBe(true)
    expect(JSON.stringify(raw)).not.toMatch(/prompt|reply|token|proxy/i)
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it("rejects relative paths instead of storing them", async () => {
    const store = new WorkspaceStore({ filePath })

    await expect(store.add("relative/path")).rejects.toThrow("WORKSPACE_UNAVAILABLE")
    await expect(store.list()).resolves.toEqual([])
  })

  it("ignores a corrupt file and recovers on the next add", async () => {
    await writeFile(filePath, "{not json", "utf8")
    const store = new WorkspaceStore({ filePath })

    await expect(store.list()).resolves.toEqual([])
    await store.add("/Users/me/recovered")
    await expect(store.list()).resolves.toEqual(["/Users/me/recovered"])
  })

  it("filters non-string and relative entries from an existing file", async () => {
    await writeFile(filePath, JSON.stringify(["/Users/me/ok", 42, "relative", null]), "utf8")
    const store = new WorkspaceStore({ filePath })

    await expect(store.list()).resolves.toEqual(["/Users/me/ok"])
  })
})
