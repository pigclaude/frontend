// 负责验证侧栏项目显示名文件：只存登记项目的名字、重启后还在、名字有长度限制、损坏文件当作没有名字。

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ProjectNameStore } from "./project-names"

let directory: string
let filePath: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-project-names-"))
  filePath = join(directory, "project-names.json")
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("project name store", () => {
  it("keeps a renamed project's display name across instances", async () => {
    await new ProjectNameStore({ filePath }).rename("/work/api", "  后端  ", ["/work/api"])

    await expect(new ProjectNameStore({ filePath }).names(["/work/api"])).resolves.toEqual({
      "/work/api": "后端",
    })
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it("rejects empty, overlong and control-character names without writing", async () => {
    const store = new ProjectNameStore({ filePath })

    for (const name of ["   ", "名".repeat(121), "a\nb"]) {
      await expect(store.rename("/work/api", name, ["/work/api"])).rejects.toThrow(
        "PROJECT_NAME_INVALID",
      )
    }
    await expect(stat(filePath)).rejects.toThrow()
  })

  it("returns and keeps only names of projects still in the sidebar", async () => {
    const store = new ProjectNameStore({ filePath })
    await store.rename("/work/old", "旧项目", ["/work/old"])

    await expect(store.rename("/work/api", "后端", ["/work/api"])).resolves.toEqual({
      "/work/api": "后端",
    })
    const raw: unknown = JSON.parse(await readFile(filePath, "utf8"))
    expect(raw).toEqual({ "/work/api": "后端" })
  })

  it("forgets a removed project's name", async () => {
    const store = new ProjectNameStore({ filePath })
    await store.rename("/work/api", "后端", ["/work/api"])

    await store.forget("/work/api")

    await expect(store.names(["/work/api"])).resolves.toEqual({})
  })

  it("treats a corrupt or foreign file as having no names", async () => {
    const store = new ProjectNameStore({ filePath })
    await writeFile(filePath, "{not json", "utf8")
    await expect(store.names(["/work/api"])).resolves.toEqual({})
    await writeFile(filePath, JSON.stringify({ "/work/api": 42, "/work/web": "前端" }), "utf8")
    await expect(store.names(["/work/api", "/work/web"])).resolves.toEqual({ "/work/web": "前端" })
  })
})
