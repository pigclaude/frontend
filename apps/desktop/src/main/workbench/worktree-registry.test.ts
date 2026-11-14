// 负责验证 worktree 登记：记下 worktree 属于哪个项目，只把仍在最近项目里的项目的 worktree 当作工作台目录，
// 文件损坏时当作没有登记，条数有上限。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WorktreeRegistry } from "./worktree-registry"

let directory: string
let filePath: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-worktree-registry-"))
  filePath = join(directory, "worktrees.json")
  for (const name of ["app", "app-worktree-1", "app-worktree-2", "api", "api-worktree"])
    await mkdir(join(directory, name))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("worktree registry", () => {
  it("lists the worktrees of the given projects, including worktrees made from a worktree", async () => {
    const registry = new WorktreeRegistry({ filePath })
    const app = join(directory, "app")
    const api = join(directory, "api")
    await registry.remember(join(directory, "app-worktree-1"), app)
    await registry.remember(join(directory, "app-worktree-2"), join(directory, "app-worktree-1"))
    await registry.remember(join(directory, "api-worktree"), api)

    expect(await registry.roots([app])).toEqual([
      join(directory, "app-worktree-1"),
      join(directory, "app-worktree-2"),
    ])
    expect(await registry.roots([api, app])).toHaveLength(3)
    expect(await registry.roots([])).toEqual([])
    expect(JSON.parse(await readFile(filePath, "utf8"))).toContainEqual({
      path: join(directory, "app-worktree-2"),
      project: app,
    })
  })

  it("skips worktrees whose folder is gone and treats a broken file as empty", async () => {
    const registry = new WorktreeRegistry({ filePath })
    const app = join(directory, "app")
    await registry.remember(join(directory, "app-worktree-1"), app)
    await rm(join(directory, "app-worktree-1"), { recursive: true })
    expect(await registry.roots([app])).toEqual([])

    await writeFile(filePath, "{not json")
    expect(await registry.roots([app])).toEqual([])
    await writeFile(filePath, JSON.stringify([{ path: "relative", project: app }, 3]))
    expect(await registry.roots([app])).toEqual([])
  })

  it("rejects relative paths and keeps only the newest entries", async () => {
    const registry = new WorktreeRegistry({ filePath, maxEntries: 1 })
    const app = join(directory, "app")
    await expect(registry.remember("relative", app)).rejects.toThrow("WORKBENCH_PATH_INVALID")
    await registry.remember(join(directory, "app-worktree-1"), app)
    await registry.remember(join(directory, "app-worktree-2"), app)

    expect(await registry.roots([app])).toEqual([join(directory, "app-worktree-2")])
  })
})
