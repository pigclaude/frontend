// 模拟 Windows Git 启动器偶发以 1 退出，验证重试仅覆盖可重复的工作台命令。
import { afterEach, expect, it, vi } from "vitest"
import { describeWorkbenchGitFailure, runWorkbenchGit } from "./git-command"

const runner = vi.hoisted(() => ({
  execute: vi.fn(),
  platform: "win32" as NodeJS.Platform,
}))

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util")
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: runner.execute }) }
})
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  platform: () => runner.platform,
}))

const root = "C:\\fixture\\workspace"
const index = { GIT_INDEX_FILE: "C:\\fixture\\temporary-index\\index" }

function launchFailure(fields: Record<string, unknown> = {}) {
  return Object.assign(new Error("Git process exited"), {
    code: 1,
    signal: null,
    killed: false,
    stdout: "",
    stderr: "",
    ...fields,
  })
}

afterEach(() => {
  runner.platform = "win32"
  runner.execute.mockReset()
})

it.each([
  { args: ["rev-parse", "--show-toplevel"], env: {}, stdout: "early standard output\n" },
  { args: ["ls-files", "-z"], env: {}, stdout: "" },
  { args: ["write-tree"], env: index, stdout: "" },
  { args: ["-c", "core.autocrlf=false", "add", "-A"], env: index, stdout: "" },
])("retries the Windows launcher failure once for $args", async ({ args, env, stdout }) => {
  runner.execute
    .mockRejectedValueOnce(launchFailure({ stdout }))
    .mockResolvedValueOnce({ stdout: "retried output\n", stderr: "" })

  await expect(runWorkbenchGit(root, args, env)).resolves.toBe("retried output\n")
  expect(runner.execute).toHaveBeenCalledTimes(2)
  expect(runner.execute.mock.calls[1]).toEqual(runner.execute.mock.calls[0])
})

it.each([
  { args: ["restore", "--worktree"], env: index },
  { args: ["update-ref", "refs/pigclaude/checkpoints/fixture", "oid"], env: {} },
  { args: ["clean", "-f", "--", "untracked.txt"], env: {} },
  { args: ["add", "-A"], env: {} },
])(
  "never repeats a command that can change the worktree or its index: $args",
  async ({ args, env }) => {
    const error = launchFailure()
    runner.execute.mockRejectedValueOnce(error)
    await expect(runWorkbenchGit(root, args, env)).rejects.toBe(error)
    expect(runner.execute).toHaveBeenCalledTimes(1)
  },
)

it.each([
  { stderr: "fatal: not a git repository" },
  { signal: "SIGTERM" },
  { killed: true },
  { code: 128 },
])("preserves an ordinary Git failure or cancellation without replay: %o", async (fields) => {
  const error = launchFailure(fields)
  runner.execute.mockRejectedValueOnce(error)
  await expect(runWorkbenchGit(root, ["rev-parse", "--show-toplevel"])).rejects.toBe(error)
  expect(runner.execute).toHaveBeenCalledTimes(1)
})

it("preserves the second failure with its original diagnostic", async () => {
  const error = launchFailure({ code: 128, stderr: "fatal: invalid revision" })
  runner.execute.mockRejectedValueOnce(launchFailure()).mockRejectedValueOnce(error)

  await expect(runWorkbenchGit(root, ["rev-parse", "--verify", "HEAD"])).rejects.toBe(error)
  expect(describeWorkbenchGitFailure(error)).toBe("git rev-parse code=128 signal=none")
  expect(runner.execute).toHaveBeenCalledTimes(2)
})

it("preserves non-Windows Git behavior", async () => {
  runner.platform = "linux"
  const error = launchFailure()
  runner.execute.mockRejectedValueOnce(error)

  await expect(runWorkbenchGit(root, ["rev-parse", "--show-toplevel"])).rejects.toBe(error)
  expect(runner.execute).toHaveBeenCalledTimes(1)
})
