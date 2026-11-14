// 负责验证新会话草稿的分支与 worktree：显示当前分支，切换失败时说明原因，可以新建分支；
// 打开 worktree 开关后会话在新 worktree 里开始，worktree 不进最近项目，会话仍挂在原项目下。
// @vitest-environment jsdom
import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { WorkbenchBranches, WorkbenchBridge } from "../../workbench-contract"
import { DesktopApp } from "./app"
import { chooseSelect } from "./test-support/base-ui-select"
import { typeAndSend } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeWorkbench } from "./test-support/workbench-harness"

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({
    resolved: "dark",
    settings: { smartPunctuation: false },
    update: () => undefined,
  }),
}))

const app = desktopAppRoot()
const worktreePath = "/work/api-worktree-1a2b3c4d"

function branchesOn(current: string, extra: string[] = []): WorkbenchBranches {
  return {
    currentBranch: current,
    head: "4f2c9e1a7b3d5f60812c4e9a0b7d6c5e3f2a1b09",
    localBranches: ["feature", "main", ...extra],
    remoteBranches: ["origin/main"],
  }
}

async function renderWithBranches(overrides: Partial<WorkbenchBridge>) {
  installFakeDesktopBridge()
  const pigclaude = window.pigclaude
  if (!pigclaude?.session || !pigclaude.workspaces) throw new Error("没有桌面桥")
  const workbench = {
    ...fakeWorkbench({ "README.md": "# demo\n" }).bridge,
    branches: vi.fn(async () => branchesOn("main")),
    ...overrides,
  }
  const startSession = pigclaude.session.start
  const start = vi.fn<typeof startSession>((input) => startSession(input))
  const add = vi.spyOn(pigclaude.workspaces, "add")
  window.pigclaude = { ...pigclaude, workbench, session: { ...pigclaude.session, start } }
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  await flush()
  return { workbench, start, add }
}

function branchChip(): HTMLButtonElement {
  const chip = app.container.querySelector<HTMLButtonElement>("button.draft-branch")
  if (!chip) throw new Error("草稿上没有分支按钮")
  return chip
}

async function pickBranch(name: string): Promise<void> {
  await vi.waitFor(() => expect(document.querySelector(".draft-branch-menu")).toBeNull())
  await userEvent.setup({ delay: null }).click(branchChip())
  const option = await vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[aria-label="${name}"][role="option"]`)
    if (!found) throw new Error(`分支菜单里没有 ${name}`)
    return found
  })
  await act(async () => option.click())
  await flush()
}

function projectNames(): string[] {
  return [...app.container.querySelectorAll<HTMLElement>("button.proj")].map(
    (row) => row.textContent?.trim() ?? "",
  )
}

describe("new session draft branches and worktrees", { timeout: 20_000 }, () => {
  it("shows the current branch and tells why switching failed without losing anything", async () => {
    const switchBranch = vi
      .fn<WorkbenchBridge["switchBranch"]>()
      .mockRejectedValueOnce(new Error("WORKBENCH_BRANCH_CONFLICT"))
      .mockResolvedValueOnce(branchesOn("feature"))
    const { workbench } = await renderWithBranches({ switchBranch })

    expect(workbench.branches).toHaveBeenCalledWith("/work/api")
    expect(branchChip().getAttribute("aria-label")).toBe("切换 Git 分支 · main")

    await pickBranch("feature")
    expect(switchBranch).toHaveBeenLastCalledWith("/work/api", "feature", false)
    expect(document.body.textContent).toContain("切换会覆盖未提交的改动，没有切换")
    expect(branchChip().getAttribute("aria-label")).toBe("切换 Git 分支 · main")

    await pickBranch("feature")
    expect(branchChip().getAttribute("aria-label")).toBe("切换 Git 分支 · feature")
  })

  it("creates a branch from the draft and keeps the dialog open with the reason when it fails", async () => {
    const switchBranch = vi
      .fn<WorkbenchBridge["switchBranch"]>()
      .mockRejectedValueOnce(new Error("WORKBENCH_BRANCH_EXISTS"))
      .mockResolvedValueOnce(branchesOn("fix/typo", ["fix/typo"]))
    await renderWithBranches({ switchBranch })
    const user = userEvent.setup({ delay: null })

    await user.click(branchChip())
    const create = await vi.waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>("button.draft-branch-create")
      if (!found) throw new Error("分支菜单里没有创建分支")
      return found
    })
    await act(async () => create.click())
    const input = await vi.waitFor(() => {
      const found = document.querySelector<HTMLInputElement>('[role="dialog"] input')
      if (!found) throw new Error("没有分支名输入框")
      return found
    })
    await user.type(input, "fix/typo{Enter}")
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe(
        "已经有同名的分支。",
      ),
    )

    await user.type(input, "{Enter}")
    await flush()
    expect(switchBranch).toHaveBeenLastCalledWith("/work/api", "fix/typo", true)
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull(), {
      timeout: 5_000,
    })
    expect(branchChip().getAttribute("aria-label")).toBe("切换 Git 分支 · fix/typo")
  })

  it("starts the session in a new worktree that stays out of the recent projects", async () => {
    const createWorktree = vi.fn<WorkbenchBridge["createWorktree"]>(async () => ({
      path: worktreePath,
      branch: "pigclaude/worktree-1a2b3c4d",
    }))
    const { start, add } = await renderWithBranches({ createWorktree })

    const toggle = app.container.querySelector<HTMLElement>(".draft-worktree [role='switch']")
    await act(async () => toggle?.click())
    await flush()
    await typeAndSend(app.container, "检查依赖")
    await flush()
    await flush()

    expect(createWorktree).toHaveBeenCalledExactlyOnceWith("/work/api", undefined)
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: worktreePath, projectPath: "/work/api" }),
    )
    expect(add.mock.calls.map(([path]) => path)).toEqual(["/work/api"])
    expect(projectNames()).toEqual(["api", "web"])
    const sessionsByProject = [...app.container.querySelectorAll<HTMLElement>(".proj-block")].map(
      (block) => [
        block.querySelector("button.proj")?.textContent?.trim(),
        block.querySelectorAll(".proj-sessions .sess").length,
      ],
    )
    expect(sessionsByProject).toEqual([
      ["api", 1],
      ["web", 0],
    ])
  })

  it("restores a project's selected worktree when returning from another project draft", async () => {
    const { start } = await renderWithBranches({
      worktrees: vi.fn(async () => [
        { path: "/work/api", branch: "main" },
        { path: worktreePath, branch: "pigclaude/worktree-1a2b3c4d" },
      ]),
      useWorktree: vi.fn(async () => undefined),
    })
    const projectButton = (name: string, action: string) =>
      [...app.container.querySelectorAll("button.proj")]
        .find((row) => row.textContent?.trim() === name)
        ?.closest(".proj-row")
        ?.querySelector<HTMLButtonElement>(action)

    await act(async () => projectButton("api", ".proj-files")?.click())
    await flush()
    const picker = app.container.querySelector<HTMLElement>(".worktree-compact-select")
    if (!picker) throw new Error("没有工作树选择器")
    await chooseSelect(picker, "pigclaude/worktree-1a2b3c4d")
    await flush()
    await act(async () => projectButton("web", ".proj-add")?.click())
    await flush()

    const back = app.container.querySelector<HTMLButtonElement>('button[aria-label="后退"]')
    if (!back) throw new Error("没有后退按钮")
    await act(async () => back.click())
    await flush()
    await typeAndSend(app.container, "检查工作树")

    expect(start).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ workspace: worktreePath }),
    )
  })

  it("keeps the text and explains why a worktree could not be created", async () => {
    const createWorktree = vi
      .fn<WorkbenchBridge["createWorktree"]>()
      .mockRejectedValue(new Error("WORKBENCH_WORKTREE_BASE_INVALID"))
    const { start } = await renderWithBranches({ createWorktree })

    const toggle = app.container.querySelector<HTMLElement>(".draft-worktree [role='switch']")
    await act(async () => toggle?.click())
    await flush()
    await typeAndSend(app.container, "检查依赖")
    await flush()

    expect(start).not.toHaveBeenCalled()
    const alert = app.container.querySelector(".draft-workspace-status[role='alert']")
    expect(alert?.textContent).toContain("创建 worktree 会话失败")
    expect(alert?.textContent).toContain("worktree 的起点无效，请重新选择分支。")
    expect(app.container.querySelector(".composer .tiptap")?.textContent).toContain("检查依赖")
  })
})
