// 负责验证草稿分支与 worktree 的 IPC：分支列出、切换和新建，worktree 创建和选用，
// 都先校验来源、会员和参数，失败只返回登记过的错误码；新建或选用的 worktree 记到所属项目下。
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { IpcMainInvokeEvent } from "electron"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkbenchBranches, WorkbenchWorktree } from "../../workbench-contract"
import { WorkbenchIpc } from "./workbench-ipc"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const { handlers, window } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  window: { id: "main-window" },
}))

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    },
  },
  BrowserWindow: {
    fromWebContents: (contents: unknown) => (contents === trustedSender ? window : null),
  },
}))
vi.mock("./browser-surface", () => ({ WorkbenchBrowsers: class {} }))
vi.mock("./terminal-service", () => ({ WorkbenchTerminals: class {} }))

const trustedSender = { id: "trusted", isDestroyed: () => false, send: () => undefined }
const exec = promisify(execFile)
let directory: string
let project: string
let state: MembershipView["state"]
let activeTurns: string[]
const remembered: Array<[string, string]> = []

const git = (...args: string[]) =>
  exec("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.test", ...args], {
    cwd: project,
  })

function call(name: string, ...args: unknown[]): Promise<unknown> {
  return callFrom(trustedSender, name, ...args)
}

function callFrom(sender: unknown, name: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get("pigclaude:workbench-" + name)
  if (!handler) throw new Error("handler not registered: " + name)
  return handler({ sender } as unknown as IpcMainInvokeEvent, ...args)
}

beforeEach(async () => {
  handlers.clear()
  remembered.length = 0
  directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-workbench-git-")))
  project = join(directory, "project")
  await mkdir(project)
  state = "active"
  activeTurns = []
  new WorkbenchIpc().register({
    isTrusted: (event) => (event.sender as unknown) === trustedSender,
    membership: () => ({ state }) as MembershipView,
    roots: async () => [project],
    hasActiveTurn: (workspace) => activeTurns.includes(workspace),
    rememberWorktree: async (path, from) => {
      remembered.push([path, from])
    },
  })
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function initRepository(): Promise<void> {
  await git("init", "-q", "-b", "main")
  await writeFile(join(project, "app.txt"), "one\n")
  await git("add", ".")
  await git("commit", "-q", "-m", "init")
}

describe("workbench branch and worktree IPC", { timeout: 20_000 }, () => {
  it("checks the caller, membership and project before reading branches", async () => {
    await expect(call("branches", project)).resolves.toBeNull()
    await initRepository()
    await expect(call("branches", project)).resolves.toMatchObject({
      currentBranch: "main",
      localBranches: ["main"],
    })

    await expect(callFrom({ id: "other" }, "branches", project)).rejects.toThrow(
      "UNTRUSTED_WORKSPACE_REQUEST",
    )
    await expect(call("branches", directory)).rejects.toThrow("WORKBENCH_PROJECT_REQUIRED")
    state = "expired"
    await expect(call("branches", project)).rejects.toThrow("MEMBERSHIP_REQUIRED")
  })

  it("switches and creates branches, and reports why a switch failed", async () => {
    await initRepository()
    await git("branch", "feature")

    const switched = (await call("branch-switch", project, "feature", false)) as WorkbenchBranches
    expect(switched.currentBranch).toBe("feature")
    const created = (await call("branch-switch", project, "fix/typo", true)) as WorkbenchBranches
    expect(created.currentBranch).toBe("fix/typo")

    await expect(call("branch-switch", project, "fix/typo", true)).rejects.toThrow(
      "WORKBENCH_BRANCH_EXISTS",
    )
    await expect(call("branch-switch", project, "bad..name", true)).rejects.toThrow(
      "WORKBENCH_BRANCH_INVALID",
    )
    for (const args of [
      [1, false],
      ["main", "yes"],
      ["x".repeat(241), false],
    ]) {
      await expect(call("branch-switch", project, ...args)).rejects.toThrow(
        "WORKBENCH_INPUT_INVALID",
      )
    }
    activeTurns = [project]
    await expect(call("branch-switch", project, "main", false)).rejects.toThrow(
      "WORKBENCH_TURN_ACTIVE",
    )
  })

  it("switches branches while only a session in another workspace has a running turn", async () => {
    await initRepository()
    await git("branch", "feature")
    activeTurns = [join(directory, "other-project")]

    await call("branch-switch", project, "feature", false)

    await expect(call("branches", project)).resolves.toMatchObject({ currentBranch: "feature" })
  })

  it("creates a worktree from a chosen base and records it under the project", async () => {
    await initRepository()

    const created = (await call("worktree-create", project, "refs/heads/main")) as WorkbenchWorktree
    expect(remembered).toEqual([[created.path, project]])

    await expect(call("worktree-create", project, "main")).rejects.toThrow(
      "WORKBENCH_WORKTREE_BASE_INVALID",
    )
    await expect(call("worktree-create", project, 42)).rejects.toThrow("WORKBENCH_INPUT_INVALID")
    expect(remembered).toHaveLength(1)
  })

  it("records an existing worktree of the project and refuses any other folder", async () => {
    await initRepository()
    const linked = join(directory, "linked worktree")
    await git("worktree", "add", "-q", "-b", "linked", "--", linked)

    const spellings =
      process.platform === "win32" ? [linked, linked.replaceAll("\\", "/")] : [linked]
    for (const path of spellings) await call("worktree-use", project, path)
    expect(remembered).toEqual(spellings.map((path) => [path, project]))

    const other = join(directory, "linked worktree extra")
    await mkdir(other)
    await expect(call("worktree-use", project, other)).rejects.toThrow("WORKBENCH_PATH_INVALID")
    await expect(call("worktree-use", project, 7)).rejects.toThrow("WORKBENCH_INPUT_INVALID")
    expect(remembered).toHaveLength(spellings.length)
  })
})
