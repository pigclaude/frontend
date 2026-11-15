// 使用临时项目验证工作台文件、Git 和凭据隔离边界。
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { workbenchChildEnv } from "./child-env"
import {
  captureWorkbenchCheckpoint,
  listWorkbenchCheckpoints,
  resolveWorkbenchCheckpoint,
  restoreWorkbenchCheckpoint,
} from "./git-checkpoints"
import {
  createWorkbenchWorktree,
  listWorkbenchWorktrees,
  removeWorkbenchWorktree,
  workbenchDiff,
} from "./git-workspace"
import {
  listWorkbenchDirectory,
  readWorkbenchFile,
  saveWorkbenchFile,
  searchWorkbenchFiles,
} from "./workspace-files"
import { workspaceDirectory, workspacePath } from "./workspace-path"

const exec = promisify(execFile)
let directory: string
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
  directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-workbench-unit-")))
  root = join(directory, "project")
  await mkdir(root)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("workbench filesystem", () => {
  it("lists and searches a registered workspace while protecting worktrees and outside paths", async () => {
    await mkdir(join(root, "docs"))
    await mkdir(join(root, ".claude", "worktrees"), { recursive: true })
    await writeFile(join(root, "docs", "readme.md"), "hello\n")
    await writeFile(join(root, ".claude", "settings.local.json"), "fixture")
    await writeFile(join(root, ".claude", "worktrees", "example.txt"), "internal")
    await writeFile(join(directory, "outside.txt"), "outside")
    if (process.platform !== "win32")
      await symlink(join(directory, "outside.txt"), join(root, "link.txt"))
    await expect(workspaceDirectory(root, [root])).resolves.toBe(root)
    await expect(workspaceDirectory(dirname(root), [root])).rejects.toThrow(
      "WORKBENCH_PROJECT_REQUIRED",
    )
    await expect(listWorkbenchDirectory(root, "")).resolves.toMatchObject({
      entries: [
        { path: ".claude", kind: "directory" },
        { path: "docs", kind: "directory" },
      ],
    })
    await expect(listWorkbenchDirectory(root, ".claude")).resolves.toMatchObject({
      entries: [{ path: ".claude/settings.local.json", kind: "file" }],
    })
    await expect(searchWorkbenchFiles(root, "docs readme")).resolves.toMatchObject({
      entries: [{ path: "docs/readme.md" }],
    })
    await expect(workspacePath(root, "../outside.txt")).rejects.toThrow("WORKBENCH_PATH_INVALID")
    await expect(workspacePath(root, ".claude/worktrees/example.txt")).rejects.toThrow(
      "WORKBENCH_PATH_INVALID",
    )
    if (process.platform !== "win32")
      await expect(workspacePath(root, "link.txt")).rejects.toThrow("WORKBENCH_PATH_INVALID")
  })

  it("lists directories first in natural name order and hides private and dependency folders", async () => {
    for (const name of ["src", "Docs", ".git", ".claude", "node_modules", ".superpowers"]) {
      await mkdir(join(root, name))
    }
    for (const name of ["file10.txt", "b.txt", "file2.txt", "A.md"]) {
      await writeFile(join(root, name), "")
    }

    const listing = await listWorkbenchDirectory(root, "")

    expect(listing.entries.map((entry) => entry.name)).toEqual([
      ".claude",
      "Docs",
      "src",
      "A.md",
      "b.txt",
      "file2.txt",
      "file10.txt",
    ])
  })

  it("preserves CRLF and asks for explicit overwrite when disk content has changed", async () => {
    const file = join(root, "note.txt")
    await writeFile(file, "initial\r\n")
    const original = await readWorkbenchFile(root, "note.txt")
    expect(original.eol).toBe("crlf")
    await saveWorkbenchFile(root, "note.txt", "edited\n", original.mtimeMs)
    expect(await readFile(file, "utf8")).toBe("edited\r\n")
    await expect(
      saveWorkbenchFile(root, "note.txt", "stale", original.mtimeMs - 1),
    ).rejects.toThrow("WORKBENCH_FILE_CHANGED")
    await saveWorkbenchFile(root, "note.txt", "approved\n", null)
    expect(await readFile(file, "utf8")).toBe("approved\r\n")
  })

  it("does not inherit provider, proxy or OAuth credentials in terminal and git commands", () => {
    expect(
      workbenchChildEnv({
        PATH: "/bin",
        HOME: root,
        LC_ALL: "C",
        PIGCLAUDE_DEV_PROVIDER_AUTH_TOKEN: "fixture",
        ANTHROPIC_AUTH_TOKEN: "fixture",
        DATABASE_URL: "fixture",
        HTTPS_PROXY: "fixture",
      }),
    ).toEqual({ PATH: "/bin", HOME: root, LC_ALL: "C" })
  })
})

describe("workbench Git", { timeout: 20_000 }, () => {
  async function init(): Promise<void> {
    await git("init", "-q", "-b", "main")
    await writeFile(join(root, "tracked.txt"), "before\n")
    await git("add", "--", "tracked.txt")
    await git("commit", "-qm", "initial")
  }

  it("shows staged, unstaged and new files without modifying the index", async () => {
    await init()
    await writeFile(join(root, "tracked.txt"), "staged\n")
    await git("add", "--", "tracked.txt")
    await writeFile(join(root, "tracked.txt"), "working\n")
    await writeFile(join(root, "new file.txt"), "added\n")
    await mkdir(join(root, ".claude", "worktrees"), { recursive: true })
    await writeFile(join(root, ".claude", "settings.json"), "project configuration fixture\n")
    await writeFile(join(root, ".claude", "worktrees", "example.txt"), "worktree fixture\n")
    const before = await git("diff", "--cached")
    const patch = await workbenchDiff(root)
    expect(patch).toContain("+working")
    expect(patch).toContain("+added")
    expect(patch).toContain("+project configuration fixture")
    expect(patch).not.toContain("worktree fixture")
    await expect(workbenchDiff(root, ".claude/worktrees/example.txt")).rejects.toThrow(
      "WORKBENCH_PATH_INVALID",
    )
    expect(await workbenchDiff(root, "tracked.txt")).not.toContain("+added")
    expect(await git("diff", "--cached")).toBe(before)
  })

  it("restores a checkpoint with a recovery snapshot and does not overwrite staging", async () => {
    await init()
    await git("config", "core.autocrlf", "true")
    await mkdir(join(root, ".claude", "worktrees"), { recursive: true })
    const settings = join(root, ".claude", "settings.json")
    const linkedFile = join(root, ".claude", "worktrees", "example.txt")
    await writeFile(settings, "{}\n")
    await writeFile(linkedFile, "worktree before\n")
    await writeFile(join(root, "tracked.txt"), "checkpoint\n")
    const checkpoint = await captureWorkbenchCheckpoint(root)
    expect((await listWorkbenchCheckpoints(root))[0]).toMatchObject({
      id: checkpoint,
      phase: "manual",
    })
    await writeFile(join(root, "tracked.txt"), "stage\n")
    await git("add", "--", "tracked.txt")
    await writeFile(join(root, "tracked.txt"), "working\n")
    await writeFile(settings, '{ "env": {} }\n')
    await writeFile(linkedFile, "worktree after\n")
    await writeFile(join(root, "created-after.txt"), "created later\n")
    await writeFile(join(root, "staged-after.txt"), "staged later\n")
    await git("add", "--", "staged-after.txt")
    const index = await git("diff", "--cached")
    const base = await resolveWorkbenchCheckpoint(root, checkpoint)
    expect(await workbenchDiff(root, undefined, base)).toContain("+working")
    await restoreWorkbenchCheckpoint(root, checkpoint)
    expect(await readFile(join(root, "tracked.txt"), "utf8")).toBe("checkpoint\n")
    expect(await readFile(settings, "utf8")).toBe("{}\n")
    expect(await readFile(linkedFile, "utf8")).toBe("worktree after\n")
    await expect(readFile(join(root, "created-after.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    })
    await expect(readFile(join(root, "staged-after.txt"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await git("diff", "--cached")).toBe(index)
    expect(await listWorkbenchCheckpoints(root)).toHaveLength(2)
  })

  it("preserves tracked and untracked Claude project files when restoring a legacy checkpoint", async () => {
    await init()
    await mkdir(join(root, ".claude", "commands"), { recursive: true })
    const settings = join(root, ".claude", "settings.json")
    const command = join(root, ".claude", "commands", "after.md")
    await writeFile(settings, "{}\n")
    await git("add", ".claude/settings.json")
    await git("commit", "-qm", "track settings")
    const id = await captureWorkbenchCheckpoint(root)
    const ref = (
      await git("for-each-ref", "--format=%(refname)", "refs/pigclaude/checkpoints")
    ).trim()
    const baseTree = (await git("rev-parse", "HEAD^{tree}")).trim()
    const legacy = (
      await git("commit-tree", baseTree, "-p", "HEAD", "-m", "PigClaude checkpoint")
    ).trim()
    await git("update-ref", ref, legacy)

    await writeFile(settings, '{ "env": {} }\n')
    await writeFile(command, "command added after the checkpoint\n")
    await writeFile(join(root, "tracked.txt"), "restore me\n")
    await restoreWorkbenchCheckpoint(root, id)

    expect(await readFile(join(root, "tracked.txt"), "utf8")).toBe("before\n")
    expect(await readFile(settings, "utf8")).toBe('{ "env": {} }\n')
    expect(await readFile(command, "utf8")).toBe("command added after the checkpoint\n")
  })

  it("records the session and turn a turn checkpoint belongs to", async () => {
    await init()
    const origin = { sessionId: "session-a", turnId: "turn-7" }

    const baseline = await captureWorkbenchCheckpoint(root, "baseline", origin)
    const manual = await captureWorkbenchCheckpoint(root)

    const message = async (id: string) =>
      git("log", "-1", "--format=%B", await resolveWorkbenchCheckpoint(root, id))
    expect(await message(baseline)).toContain(
      "PigClaude-Session: session-a\nPigClaude-Turn: turn-7",
    )
    expect(await message(manual)).not.toContain("PigClaude-Session")
    expect((await listWorkbenchCheckpoints(root)).map((item) => item.phase)).toEqual([
      "baseline",
      "manual",
    ])
  })

  it("creates and removes a real linked worktree while keeping the main project", async () => {
    await init()
    const linked = await createWorkbenchWorktree(root)
    const checkpoint = await captureWorkbenchCheckpoint(root)
    await expect(listWorkbenchCheckpoints(linked.path)).resolves.toEqual([])
    await expect(resolveWorkbenchCheckpoint(linked.path, checkpoint)).rejects.toThrow()
    expect((await listWorkbenchWorktrees(root)).map((item) => item.branch)).toContain(linked.branch)
    await expect(removeWorkbenchWorktree(root, root)).rejects.toThrow("WORKBENCH_PATH_INVALID")
    await writeFile(join(linked.path, "dirty.txt"), "not committed")
    await expect(removeWorkbenchWorktree(linked.path, linked.path)).rejects.toThrow()
    await rm(join(linked.path, "dirty.txt"))
    await removeWorkbenchWorktree(linked.path, linked.path)
    expect(await listWorkbenchWorktrees(root)).toHaveLength(1)
  })
})
