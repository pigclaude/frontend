// 用真实 Git 验证草稿的分支读取、切换和新建：失败时给出原因，未提交的改动不丢。
import { execFile } from "node:child_process"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { switchWorkbenchBranch, workbenchBranches } from "./git-branches"

const exec = promisify(execFile)
let root: string

const git = async (...args: string[]) =>
  (
    await exec(
      "git",
      ["-c", "user.name=Workbench QA", "-c", "user.email=workbench@example.test", ...args],
      { cwd: root },
    )
  ).stdout

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-branches-")))
  await git("init", "-q", "-b", "main")
  await writeFile(join(root, "app.txt"), "one\n")
  await git("add", ".")
  await git("commit", "-q", "-m", "init")
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("workbench branches", { timeout: 20_000 }, () => {
  it("lists the current branch, HEAD and local and remote branches", async () => {
    await git("branch", "feature/search")
    await git("update-ref", "refs/remotes/origin/main", "HEAD")
    await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
    const head = (await git("rev-parse", "HEAD")).trim()

    expect(await workbenchBranches(root)).toEqual({
      currentBranch: "main",
      head,
      localBranches: ["feature/search", "main"],
      remoteBranches: ["origin/main"],
    })
  })

  it("returns null for a plain folder and reports a detached HEAD without a branch", async () => {
    const plain = await mkdtemp(join(tmpdir(), "pigclaude-plain-"))
    try {
      expect(await workbenchBranches(plain)).toBeNull()
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
    await git("checkout", "-q", "--detach")
    expect((await workbenchBranches(root))?.currentBranch).toBeNull()
  })

  it("switches to an existing branch and creates a new one from HEAD", async () => {
    await git("branch", "feature/search")

    expect((await switchWorkbenchBranch(root, "feature/search", false))?.currentBranch).toBe(
      "feature/search",
    )
    const created = await switchWorkbenchBranch(root, "fix/typo", true)
    expect(created?.currentBranch).toBe("fix/typo")
    expect(created?.localBranches).toContain("fix/typo")
  })

  it("refuses a switch that would overwrite uncommitted changes and keeps them", async () => {
    await git("switch", "-q", "-c", "other")
    await writeFile(join(root, "app.txt"), "other\n")
    await git("commit", "-q", "-am", "other")
    await git("switch", "-q", "main")
    await writeFile(join(root, "app.txt"), "local edit\n")

    await expect(switchWorkbenchBranch(root, "other", false)).rejects.toThrow(
      "WORKBENCH_BRANCH_CONFLICT",
    )
    expect(await readFile(join(root, "app.txt"), "utf8")).toBe("local edit\n")
    expect((await workbenchBranches(root))?.currentBranch).toBe("main")
  })

  it("rejects invalid names, option-like names and an existing branch name", async () => {
    for (const name of ["bad..name", "-f", "a b", "", "main\0x"]) {
      await expect(switchWorkbenchBranch(root, name, true)).rejects.toThrow(
        "WORKBENCH_BRANCH_INVALID",
      )
    }
    await expect(switchWorkbenchBranch(root, "main", true)).rejects.toThrow(
      "WORKBENCH_BRANCH_EXISTS",
    )
    await expect(switchWorkbenchBranch(root, "missing", false)).rejects.toThrow(
      "WORKBENCH_BRANCH_FAILED",
    )
  })
})
