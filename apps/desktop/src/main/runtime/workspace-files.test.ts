// 负责验证工作区文件列表：相对路径、排序、跳过依赖/版本库/隐藏项、条数上限和非法路径。

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { listWorkspaceFiles } from "./workspace-files"

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-workspace-files-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("listWorkspaceFiles", () => {
  it("lists relative paths in sorted order and skips ignored directories and hidden entries", async () => {
    const root = await workspace()
    await mkdir(join(root, "src", "nested"), { recursive: true })
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true })
    await mkdir(join(root, ".git"), { recursive: true })
    await writeFile(join(root, "README.md"), "readme")
    await writeFile(join(root, "src", "a.ts"), "a")
    await writeFile(join(root, "src", "nested", "b.ts"), "b")
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "dep")
    await writeFile(join(root, ".git", "config"), "git")
    await writeFile(join(root, ".env"), "secret")

    await expect(listWorkspaceFiles(root)).resolves.toEqual([
      "README.md",
      "src/a.ts",
      "src/nested/b.ts",
    ])
  })

  it("stops at the requested limit", async () => {
    const root = await workspace()
    for (const name of ["a.txt", "b.txt", "c.txt"]) await writeFile(join(root, name), name)

    await expect(listWorkspaceFiles(root, 2)).resolves.toEqual(["a.txt", "b.txt"])
  })

  it.skipIf(process.platform === "win32")("does not follow symbolic links", async () => {
    const root = await workspace()
    const outside = await workspace()
    await writeFile(join(outside, "secret.txt"), "secret")
    await symlink(outside, join(root, "linked"))
    await writeFile(join(root, "own.txt"), "own")

    await expect(listWorkspaceFiles(root)).resolves.toEqual(["own.txt"])
  })

  it("rejects relative or missing workspaces", async () => {
    await expect(listWorkspaceFiles("relative/path")).rejects.toThrow("工作区必须是绝对路径")
    await expect(listWorkspaceFiles(join(tmpdir(), "missing-pigclaude-workspace"))).rejects.toThrow(
      "工作区不存在",
    )
  })
})
