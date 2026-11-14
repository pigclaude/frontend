// 负责验证工作台 Git 子进程失败时可供诊断的摘要：只含子命令、退出码和信号，不含路径或输出。
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { describeWorkbenchGitFailure, runWorkbenchGit } from "./git-command"

let directory: string

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-git-command-")))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

it("describes a failed git command by subcommand, exit code and signal without paths", async () => {
  const failure = await runWorkbenchGit(
    directory,
    ["-c", "core.autocrlf=false", "ls-files", "-z", "--", directory],
    { GIT_CEILING_DIRECTORIES: dirname(directory) },
  ).catch((error: unknown) => error)

  expect(describeWorkbenchGitFailure(failure)).toBe("git ls-files code=128 signal=none")
})

it("does not describe errors that did not come from a workbench git process", () => {
  expect(describeWorkbenchGitFailure(new Error("spawn EACCES /Users/me/.secret/git"))).toBeNull()
  expect(describeWorkbenchGitFailure("WORKBENCH_OPERATION_FAILED")).toBeNull()
})
