// 负责验证主窗口的工作目录选择：选用 worktree 只记它属于哪个项目，会话开始时放进最近项目的是项目本身，
// 从 worktree 再建的 worktree 也归到原项目。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { useWorkspaceSelection, type WorkspaceSelection } from "./use-workspace-selection"

async function mount(addProject: (path: string) => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const current: { value: WorkspaceSelection | null } = { value: null }
  function Probe() {
    current.value = useWorkspaceSelection(addProject)
    return null
  }
  const root = createRoot(document.createElement("div"))
  await act(async () => root.render(createElement(Probe)))
  return {
    get selection(): WorkspaceSelection {
      if (!current.value) throw new Error("没有挂载")
      return current.value
    },
    act: (run: (selection: WorkspaceSelection) => void) =>
      act(async () => {
        if (current.value) run(current.value)
      }),
  }
}

describe("workspace selection", () => {
  it("keeps worktrees under their project and adds only the project to the recent list", async () => {
    const addProject = vi.fn(async () => undefined)
    const probe = await mount(addProject)

    await probe.act((selection) => selection.selectWorktree("/work/api-wt-1", "/work/api"))
    expect(probe.selection.selected).toBe("/work/api-wt-1")
    expect(probe.selection.projectOf("/work/api-wt-1")).toBe("/work/api")

    await probe.act((selection) => selection.selectWorktree("/work/api-wt-2", "/work/api-wt-1"))
    expect(probe.selection.projectOf("/work/api-wt-2")).toBe("/work/api")

    await probe.act((selection) => selection.used("/work/api-wt-2", "/work/api"))
    expect(probe.selection.session).toBe("/work/api-wt-2")
    expect(addProject).toHaveBeenCalledExactlyOnceWith("/work/api")

    await probe.act((selection) => selection.selectWorktree("/work/api", "/work/api-wt-2"))
    expect(probe.selection.selected).toBe("/work/api")
    expect(probe.selection.projectOf("/work/api")).toBe("/work/api")
    expect(probe.selection.projectOf(null)).toBeNull()
  })

  it("records a worktree a session started in so the sidebar shows it under the project", async () => {
    const probe = await mount(async () => {
      throw new Error("最近项目写入失败")
    })

    await probe.act((selection) => selection.used("/work/web-wt", "/work/web"))

    expect(probe.selection.selected).toBe("/work/web-wt")
    expect(probe.selection.projectOf("/work/web-wt")).toBe("/work/web")
  })
})
