// 使用临时 Git 仓库验证定时任务从选定分支创建并登记工作树。

import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, it, vi } from "vitest"
import type { ScheduledTaskInput } from "../../scheduled-tasks-contract"
import { WorktreeRegistry } from "../workbench/worktree-registry"
import type { ScheduledTaskRunnerPorts } from "./runner"
import { runScheduledWorkspace } from "./workspace"

const exec = promisify(execFile)

it("从配置的分支隔离运行，并清理没有留下会话的工作树", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-scheduled-worktree-")))
  const project = join(root, "project")
  await mkdir(project)
  const git = (...args: string[]) =>
    exec(
      "git",
      ["-c", "user.name=Schedule QA", "-c", "user.email=schedule@example.test", ...args],
      { cwd: project },
    ).then(({ stdout }) => stdout)
  const file = join(project, "README.md")
  const registry = new WorktreeRegistry({ filePath: join(root, "worktrees.json") })
  const task: ScheduledTaskInput = {
    projectPath: project,
    title: "检查发布分支",
    prompt: "检查版本",
    rule: { kind: "daily", time: "09:00" },
    endsAt: null,
    enabled: true,
    model: null,
    permissionMode: "default",
    accountId: null,
    worktree: { baseRef: "refs/heads/release" },
  }
  const signal = new AbortController().signal
  try {
    await git("init", "-q", "-b", "main")
    await writeFile(file, "main")
    await git("add", ".")
    await git("commit", "-qm", "main")
    await git("switch", "-qc", "release")
    await writeFile(file, "release")
    await git("commit", "-qam", "release")
    await git("switch", "-q", "main")

    const launch = vi.fn<ScheduledTaskRunnerPorts["runSession"]>(
      async (_task, _signal, workspace) => {
        if (!workspace) throw new Error("没有独立工作树")
        expect(workspace).not.toBe(project)
        expect(await readFile(join(workspace, "README.md"), "utf8")).toBe("release")
        return { status: "succeeded", sessionId: "scheduled-session" }
      },
    )
    await expect(runScheduledWorkspace(task, signal, registry, launch)).resolves.toMatchObject({
      sessionId: "scheduled-session",
    })
    const kept = launch.mock.calls[0]?.[2]
    expect(kept).toBeDefined()
    await expect(registry.roots([project])).resolves.toEqual([kept])
    await expect(readFile(file, "utf8")).resolves.toBe("main")

    const fail = vi.fn<ScheduledTaskRunnerPorts["runSession"]>(async () => ({ status: "failed" }))
    await expect(runScheduledWorkspace(task, signal, registry, fail)).resolves.toEqual({
      status: "failed",
    })
    expect(fail.mock.calls[0]?.[2]).not.toBe(kept)
    await expect(registry.roots([project])).resolves.toEqual([kept])
    expect(Object.keys(await registry.projects())).toEqual([kept])
    expect((await git("branch", "--list", "pigclaude/worktree-*")).trim().split("\n")).toHaveLength(
      1,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)
