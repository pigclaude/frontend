// 负责验证最近工作区文件：只存存在的绝对目录、最新在前、去重、最多 10 条、损坏文件回到空列表且不写入其他字段。

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
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

async function makeDirectory(name: string): Promise<string> {
  const path = join(directory, name)
  await mkdir(path, { recursive: true })
  return path
}

describe("workspace store", () => {
  it("starts empty when the file does not exist", async () => {
    const store = new WorkspaceStore({ filePath })
    await expect(store.list()).resolves.toEqual([])
  })

  it("keeps the newest existing directory first and removes duplicates", async () => {
    const store = new WorkspaceStore({ filePath })
    const beta = await makeDirectory("beta")
    const alpha = await makeDirectory("alpha")

    await store.add(beta)
    await store.add(alpha)
    await store.add(beta)

    await expect(store.list()).resolves.toEqual([beta, alpha])
  })

  it("chooses readable directories for a new draft without rewriting recent projects", async () => {
    const store = new WorkspaceStore({ filePath })
    const current = await makeDirectory("current")
    const missing = await makeDirectory("deleted")
    await store.add(current)
    await store.add(missing)
    await rm(missing, { recursive: true })

    await expect(store.available()).resolves.toEqual([current])
    await expect(store.list()).resolves.toEqual([missing, current])
  })

  it("stores at most ten paths and only stores paths", async () => {
    const store = new WorkspaceStore({ filePath })
    const paths: string[] = []
    for (let index = 0; index < 12; index += 1) {
      const path = await makeDirectory(`project-${index}`)
      paths.push(path)
      await store.add(path)
    }

    const stored = await store.list()
    expect(stored).toHaveLength(10)
    expect(stored[0]).toBe(paths[11])
    expect(stored[9]).toBe(paths[2])

    const raw: unknown = JSON.parse(await readFile(filePath, "utf8"))
    expect(Array.isArray(raw)).toBe(true)
    expect(JSON.stringify(raw)).not.toMatch(/prompt|reply|token|proxy/i)
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it("removes a project from the list without touching its folder", async () => {
    const store = new WorkspaceStore({ filePath })
    const alpha = await makeDirectory("alpha")
    const beta = await makeDirectory("beta")
    await store.add(alpha)
    await store.add(beta)

    await expect(store.remove(alpha)).resolves.toEqual([beta])
    await expect(store.remove(join(directory, "never-added"))).resolves.toEqual([beta])
    await expect(store.list()).resolves.toEqual([beta])
    expect((await stat(alpha)).isDirectory()).toBe(true)
  })

  it("rejects relative paths instead of storing them", async () => {
    const store = new WorkspaceStore({ filePath })

    await expect(store.add("relative/path")).rejects.toThrow("WORKSPACE_UNAVAILABLE")
    await expect(store.list()).resolves.toEqual([])
  })

  it("rejects a missing path and does not write the file", async () => {
    const store = new WorkspaceStore({ filePath })

    await expect(store.add(join(directory, "missing"))).rejects.toThrow("WORKSPACE_UNAVAILABLE")
    await expect(store.list()).resolves.toEqual([])
    await expect(stat(filePath)).rejects.toThrow()
  })

  it("rejects a file path instead of a directory", async () => {
    const store = new WorkspaceStore({ filePath })
    const notDirectory = join(directory, "file.txt")
    await writeFile(notDirectory, "not a directory", "utf8")

    await expect(store.add(notDirectory)).rejects.toThrow("WORKSPACE_UNAVAILABLE")
    await expect(store.list()).resolves.toEqual([])
  })

  it("ignores a corrupt file and recovers on the next add", async () => {
    await writeFile(filePath, "{not json", "utf8")
    const store = new WorkspaceStore({ filePath })
    const recovered = await makeDirectory("recovered")

    await expect(store.list()).resolves.toEqual([])
    await store.add(recovered)
    await expect(store.list()).resolves.toEqual([recovered])
  })

  it("filters non-string and relative entries from an existing file", async () => {
    await writeFile(filePath, JSON.stringify(["/Users/me/ok", 42, "relative", null]), "utf8")
    const store = new WorkspaceStore({ filePath })

    await expect(store.list()).resolves.toEqual(["/Users/me/ok"])
  })
})
