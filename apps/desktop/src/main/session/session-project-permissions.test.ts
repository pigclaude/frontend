// 从会话权限请求验证授权保存、会话间隔离、完整 flag 更新与撤销。

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { ProjectPermissionStore } from "./project-permission-store"
import { createHarness } from "./session-host-fixtures"

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

it("不会给工作台浏览器写入或重新加载长期规则", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pigclaude-browser-rules-"))
  const rule = "mcp__pigclaude_workbench__browser_open"
  const file = join(workspace, "project-permissions.json")
  const store = new ProjectPermissionStore(file)
  try {
    await expect(
      store.grant(workspace, [{ kind: "allow", value: rule }], () => true),
    ).rejects.toThrow("INVALID_SESSION_INPUT")
    expect(await store.list()).toEqual([])
    await writeFile(
      file,
      JSON.stringify([
        { id: "old-browser-rule", projectPath: workspace, kind: "allow", value: rule },
        { id: "ordinary-rule", projectPath: workspace, kind: "allow", value: "Read" },
      ]),
    )
    expect(await store.settings(workspace)).toEqual({ allow: ["Read"], additionalDirectories: [] })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
