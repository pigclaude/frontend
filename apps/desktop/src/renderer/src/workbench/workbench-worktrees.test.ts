// 负责验证文件面板里的工作树选择：选用已有工作树前先让主进程记到所属项目下，新建的工作树由主进程自己记。
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { chooseSelect } from "../test-support/base-ui-select"
import {
  button,
  fakeWorkbench,
  openFilesSurface,
  projectRoot,
  settle,
  workbenchRoot,
} from "../test-support/workbench-harness"

const screen = workbenchRoot()
const linked = "/Users/me/app-worktree-1a2b3c4d"

async function openWithWorktrees(onSelectWorkspace: (path: string) => Promise<void>) {
  const fake = fakeWorkbench({ "README.md": "# demo\n" })
  vi.mocked(fake.bridge.worktrees).mockResolvedValue([
    { path: projectRoot, branch: "main" },
    { path: linked, branch: "pigclaude/worktree-1a2b3c4d" },
  ])
  const render = screen.render.bind(screen)
  await openFilesSurface(
    { container: screen.container, render: (bridge) => render(bridge, { onSelectWorkspace }) },
    fake,
  )
  await settle()
  return fake
}

function worktreeSelect(): HTMLElement {
  const trigger = document.querySelector<HTMLElement>(".worktree-compact-select")
  expect(trigger, "工作树选择").not.toBeNull()
  return trigger as HTMLElement
}

describe("workbench worktrees", () => {
  it("records an existing worktree under the project before switching to it", async () => {
    const order: string[] = []
    const onSelectWorkspace = vi.fn(async (path: string) => {
      order.push(`select ${path}`)
    })
    const fake = await openWithWorktrees(onSelectWorkspace)
    vi.mocked(fake.bridge.useWorktree).mockImplementation(async (root, path) => {
      order.push(`use ${root} ${path}`)
    })

    await chooseSelect(worktreeSelect(), "pigclaude/worktree-1a2b3c4d")
    await settle()

    expect(order).toEqual([`use ${projectRoot} ${linked}`, `select ${linked}`])
  })

  it("lets the main process record a new worktree and does not record it again", async () => {
    const onSelectWorkspace = vi.fn(async () => undefined)
    const fake = await openWithWorktrees(onSelectWorkspace)
    const created = { path: "/Users/me/app-worktree-9f8e7d6c", branch: "pigclaude/worktree-9f8e" }
    Object.assign(fake.bridge, { createWorktree: vi.fn(async () => created) })

    button("新建").click()
    await settle()

    expect(fake.bridge.createWorktree).toHaveBeenCalledExactlyOnceWith(projectRoot)
    expect(fake.bridge.useWorktree).not.toHaveBeenCalled()
    expect(onSelectWorkspace).toHaveBeenCalledExactlyOnceWith(created.path)
  })
})
