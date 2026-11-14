// 用真实 Git 验证从草稿新建 worktree：从选定的分支起步，按 .worktreeinclude 只带上项目里被 Git 忽略的
// 匹配文件，不跟随符号链接，起点无效时不留下目录和分支。
import { execFile } from "node:child_process"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createWorkbenchWorktree, listWorkbenchWorktrees } from "./git-workspace"

const exec = promisify(execFile)
let directory: string
let root: string

const git = async (cwd: string, ...args: string[]) =>
  (
    await exec(
      "git",
      ["-c", "user.name=Workbench QA", "-c", "user.email=workbench@example.test", ...args],
      { cwd },
    )
  ).stdout

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-worktrees-")))
  root = join(directory, "project")
  await mkdir(root)
  await git(root, "init", "-q", "-b", "main")
  await writeFile(join(root, ".gitignore"), ".env\nlocal/\nlinked/\nlink.env\n*.log\n")
  await writeFile(join(root, "tracked.txt"), "tracked\n")
  await git(root, "add", ".")
  await git(root, "commit", "-q", "-m", "init")
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("workbench worktree creation", { timeout: 20_000 }, () => {
  it("starts from the chosen branch and leaves uncommitted changes in the project", async () => {
    await git(root, "switch", "-q", "-c", "feature")
    await writeFile(join(root, "feature.txt"), "feature\n")
    await git(root, "add", ".")
    await git(root, "commit", "-q", "-m", "feature")
    await git(root, "switch", "-q", "main")
    await writeFile(join(root, "tracked.txt"), "local edit\n")

    const created = await createWorkbenchWorktree(root, "refs/heads/feature")

    expect(await readFile(join(created.path, "feature.txt"), "utf8")).toBe("feature\n")
    expect(await readFile(join(created.path, "tracked.txt"), "utf8")).toBe("tracked\n")
    expect(await readFile(join(root, "tracked.txt"), "utf8")).toBe("local edit\n")
    expect((await git(created.path, "rev-parse", "HEAD")).trim()).toBe(
      (await git(root, "rev-parse", "feature")).trim(),
    )
    expect((await listWorkbenchWorktrees(root)).map((item) => item.branch)).toContain(
      created.branch,
    )
  })

  it("copies only ignored files listed in .worktreeinclude and never follows links", async () => {
    await writeFile(
      join(root, ".worktreeinclude"),
      ".env\nlocal/\nlinked/\nlink.env\nuntracked.txt\ntracked.txt\n",
    )
    await writeFile(join(root, ".env"), "TOKEN=local\n")
    await mkdir(join(root, "local", "nested"), { recursive: true })
    await writeFile(join(root, "local", "nested", "config.json"), "{}\n")
    await writeFile(join(root, "untracked.txt"), "not ignored\n")
    await writeFile(join(root, "debug.log"), "ignored but not listed\n")
    await writeFile(join(directory, "secret.txt"), "outside\n")
    await mkdir(join(directory, "outside-dir"))
    await writeFile(join(directory, "outside-dir", "file.txt"), "outside\n")
    if (process.platform !== "win32") {
      await symlink(join(directory, "secret.txt"), join(root, "link.env"))
      await symlink(join(directory, "outside-dir"), join(root, "linked"))
    }

    const created = await createWorkbenchWorktree(root)

    expect(await readFile(join(created.path, ".env"), "utf8")).toBe("TOKEN=local\n")
    expect(await readFile(join(created.path, "local", "nested", "config.json"), "utf8")).toBe(
      "{}\n",
    )
    expect(await exists(join(created.path, "untracked.txt"))).toBe(false)
    expect(await exists(join(created.path, "debug.log"))).toBe(false)
    expect(await exists(join(created.path, "link.env"))).toBe(false)
    expect(await exists(join(created.path, "linked"))).toBe(false)
    expect(await readFile(join(created.path, "tracked.txt"), "utf8")).toBe("tracked\n")
  })

  it("creates a plain worktree when the project has no .worktreeinclude", async () => {
    await writeFile(join(root, ".env"), "TOKEN=local\n")

    const created = await createWorkbenchWorktree(root)

    expect(await exists(join(created.path, ".env"))).toBe(false)
  })

  it("rejects an invalid or missing base without leaving a worktree or branch", async () => {
    const branches = await git(root, "branch", "--list")
    for (const base of ["-x", "refs/heads/../main", "refs/tags/v1", "refs/heads/missing", "main"]) {
      await expect(createWorkbenchWorktree(root, base)).rejects.toThrow(
        "WORKBENCH_WORKTREE_BASE_INVALID",
      )
    }
    expect(await listWorkbenchWorktrees(root)).toHaveLength(1)
    expect(await git(root, "branch", "--list")).toBe(branches)
  })
})
