// 从会话权限请求验证授权保存、会话间隔离、完整 flag 更新与撤销。

import { execFile } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, it, vi } from "vitest"
import { WorktreeRegistry } from "../workbench/worktree-registry"
import { ProjectPermissionStore } from "./project-permission-store"
import { createHarness } from "./session-host-fixtures"

const grant = { kind: "allow", value: "Bash(echo fixture)" } as const
const exec = promisify(execFile)

it("只在同一项目下应用规则，追加和撤销时更新整份 flags", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-project-rules-")))
  const workspace = join(root, "project")
  const unrelated = join(root, "unrelated")
  await Promise.all([mkdir(workspace), mkdir(unrelated)])
  const settingsPath = join(root, "user-data", "project-permissions.json")
  const store = new ProjectPermissionStore(settingsPath)
  const harness = createHarness({ workspace, projectPermissions: store })
  try {
    const { sessionId } = await harness.host.start({ workspace, permissionMode: "default" })
    const adapter = harness.adapters.last
    const changed = vi.spyOn(adapter, "applyFlagSettings")
    if (adapter.canUseTool === null) throw new Error("缺少会话权限入口")
    for (const content of ["echo one", "echo two"]) {
      const response = adapter.canUseTool(
        "Bash",
        { command: content },
        {
          signal: new AbortController().signal,
          requestId: content,
          toolUseID: content,
          suggestions: [
            {
              type: "addRules",
              behavior: "allow",
              rules: [{ toolName: "Bash", ruleContent: content }],
              destination: "localSettings",
            },
          ],
        },
      )
      const event = harness.events.at(-1)
      if (event?.type !== "permission") throw new Error("缺少待回答权限事件")
      expect(event.suggestions?.[0]).toMatchObject({ index: 0, canSaveProject: true })
      await harness.host.respondPermission(sessionId, {
        requestId: event.requestId,
        decision: "allow",
        suggestion: { index: 0, scope: "project" },
      })
      await expect(response).resolves.toEqual({
        behavior: "allow",
        updatedInput: { command: content },
      })
    }
    await vi.waitFor(() =>
      expect(changed).toHaveBeenLastCalledWith({
        permissions: { allow: ["Bash(echo one)", "Bash(echo two)"], additionalDirectories: [] },
      }),
    )

    const restarted = createHarness({
      workspace,
      projectPermissions: new ProjectPermissionStore(settingsPath),
    })
    try {
      await restarted.host.start({ workspace, permissionMode: "default" })
      expect(restarted.adapters.last.flagSettings).toEqual([
        { permissions: { allow: ["Bash(echo one)", "Bash(echo two)"], additionalDirectories: [] } },
      ])
    } finally {
      await restarted.host.dispose()
    }

    await harness.host.start({ workspace: unrelated, permissionMode: "default" })
    expect(harness.adapters.last.flagSettings).toEqual([])
    for (const entry of await store.list()) await store.revoke(entry.id)
    await vi.waitFor(() =>
      expect(changed).toHaveBeenLastCalledWith({
        permissions: { allow: [], additionalDirectories: [] },
      }),
    )
    expect(await store.list()).toEqual([])
  } finally {
    await harness.host.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it("从请求传入上级项目路径时仍只使用实际工作区的授权", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-project-rule-identity-")))
  const ancestor = join(dir, "project")
  const workspace = join(ancestor, "nested-workspace")
  await mkdir(workspace, { recursive: true })
  const store = new ProjectPermissionStore(join(dir, "project-permissions.json"))
  const harness = createHarness({ workspace, userDataPath: dir, projectPermissions: store })
  try {
    await store.grant(ancestor, [grant], () => true)
    await store.grant(workspace, [{ kind: "allow", value: "Bash(echo nested)" }], () => true)
    await harness.host.start({ workspace, projectPath: ancestor, permissionMode: "default" })
    expect(harness.adapters.last.flagSettings).toEqual([
      { permissions: { allow: ["Bash(echo nested)"], additionalDirectories: [] } },
    ])
  } finally {
    await harness.host.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

it("只把真实 Git worktree 的主进程登记用于共享权限", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-worktree-rules-")))
  const project = join(dir, "project")
  const worktree = join(dir, "linked")
  const unrelated = join(dir, "unrelated")
  await Promise.all([mkdir(project), mkdir(unrelated)])
  const store = new ProjectPermissionStore(join(dir, "project-permissions.json"))
  const harness = createHarness({
    workspace: project,
    userDataPath: dir,
    projectPermissions: store,
  })
  try {
    const git = (...args: string[]) =>
      exec(
        "git",
        [
          "-c",
          "user.name=Test Fixture",
          "-c",
          "user.email=fixture@example.test",
          "-c",
          "core.hooksPath=./no-hooks",
          "-c",
          "commit.gpgSign=false",
          ...args,
        ],
        { cwd: project },
      )
    await git("init", "-q")
    await git("commit", "-q", "--allow-empty", "-m", "fixture")
    await git("worktree", "add", "--detach", worktree)
    const registry = new WorktreeRegistry({ filePath: join(dir, "worktrees.json") })
    await registry.remember(worktree, project)
    await registry.remember(unrelated, project)
    await store.grant(project, [grant], () => true)

    await harness.host.start({ workspace: worktree, permissionMode: "default" })
    expect(harness.adapters.last.flagSettings).toEqual([
      { permissions: { allow: [grant.value], additionalDirectories: [] } },
    ])
    await harness.host.start({
      workspace: unrelated,
      projectPath: project,
      permissionMode: "default",
    })
    expect(harness.adapters.last.flagSettings).toEqual([])
  } finally {
    await harness.host.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}, 15_000)

it.each(["success", "process", "environment"] as const)(
  "SDK 拒绝撤销时先封闭会话权限并在停放后报告清理结果（%s）",
  async (cleanup) => {
    const workspace = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-revoke-rules-")))
    const store = new ProjectPermissionStore(join(workspace, "project-permissions.json"))
    const harness = createHarness({ workspace, projectPermissions: store })
    try {
      await store.grant(workspace, [grant], () => true)
      const { sessionId } = await harness.host.start({ workspace, permissionMode: "default" })
      const adapter = harness.adapters.last
      const entry = (await store.list())[0]
      if (!entry) throw new Error("缺少测试授权")
      vi.spyOn(adapter, "applyFlagSettings").mockRejectedValueOnce(new Error("SDK 拒绝规则更新"))
      const originalStop = adapter.stop.bind(adapter)
      const stop = vi.spyOn(adapter, "stop")
      stop.mockImplementationOnce(async () => {
        expect(harness.runtime.sessions[0]?.closed).toBe(true)
        expect(adapter.startCalls[0]?.abortController.signal.aborted).toBe(true)
        if (cleanup === "process") throw new Error("进程未能停止")
        await originalStop()
      })
      if (cleanup === "environment") {
        vi.spyOn(harness.environments.last, "cleanup").mockRejectedValueOnce(new Error("清理失败"))
      }

      if (cleanup === "success") await expect(store.revoke(entry.id)).resolves.toEqual([])
      else
        await expect(store.revoke(entry.id)).rejects.toThrow(
          "PROJECT_PERMISSIONS_SESSION_CLEANUP_FAILED",
        )
      expect(await store.list()).toEqual([])
      expect(stop).toHaveBeenCalledOnce()
      expect(harness.runtime.sessions[0]?.closed).toBe(true)
      expect(adapter.startCalls[0]?.abortController.signal.aborted).toBe(true)
      await expect(harness.host.send(sessionId, { text: "不可发送" })).rejects.toThrow()
      if (cleanup !== "process") expect(harness.host.list()[0]?.status).toBe("parked")
    } finally {
      await harness.host.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  },
)
