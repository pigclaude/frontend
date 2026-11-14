// 负责验证侧栏项目接到桌面桥：右键重命名只改显示名、在文件管理器中显示、从侧栏移除，
// 「查看文件」和「在应用中打开」，以及跑完一轮的会话行状态点和账号角标。
// @vitest-environment jsdom
import { act } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { typeAndSend } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, renderDesktopApp } from "./test-support/desktop-app-harness"
import { projectRoot, treeRow } from "./test-support/workbench-harness"

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({
    resolved: "dark",
    settings: { smartPunctuation: false },
    update: () => undefined,
  }),
}))

const app = desktopAppRoot()

function button(label: string): HTMLButtonElement {
  const found = [...app.container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  )
  if (!found) throw new Error(`没有按钮 ${label}`)
  return found
}

function projectRow(name: string): HTMLElement {
  const row = [...app.container.querySelectorAll<HTMLElement>("button.proj")].find(
    (button) => button.textContent?.trim() === name,
  )
  if (!row) throw new Error(`没有项目 ${name}`)
  return row
}

async function chooseFromMenu(name: string, item: string): Promise<void> {
  await act(async () => {
    projectRow(name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
  })
  await flush()
  const entry = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === item,
  )
  if (!entry) throw new Error(`菜单里没有 ${item}`)
  await act(async () => entry.click())
  await flush()
}

describe("sidebar project actions", () => {
  it("renames, reveals and removes a project through the desktop bridge", async () => {
    const { calls } = await renderDesktopApp(app)
    const user = userEvent.setup()
    await flush()

    await chooseFromMenu("api", "重命名")
    const input = app.container.querySelector<HTMLInputElement>('input[aria-label="项目名称"]')
    if (!input) throw new Error("没有改名输入框")
    await user.clear(input)
    await user.type(input, "后端{Enter}")
    await flush()
    expect(projectRow("后端")).toBeDefined()

    await chooseFromMenu("后端", "在访达中打开")
    await chooseFromMenu("web", "从侧栏移除")

    expect(calls).toEqual(["rename /work/api 后端", "reveal /work/api", "remove /work/web"])
    expect(() => projectRow("web")).toThrow()
  })

  it("shows the project's files in the workbench and opens the project in an installed app", async () => {
    const { calls } = await renderDesktopApp(app, ["/work/api", projectRoot])
    await flush()

    const files = projectRow("app")
      .closest(".proj-row")
      ?.querySelector<HTMLButtonElement>('button[aria-label="查看文件"]')
    if (!files) throw new Error("项目行没有查看文件")
    await act(async () => files.click())
    await flush()
    await flush()

    expect(app.container.querySelector(".right-panel-slot")?.hasAttribute("hidden")).toBe(false)
    expect(
      app.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toContain("文件")
    expect(treeRow("README.md")).toBeDefined()

    await act(async () => button("在 Ghostty 中打开").click())
    await flush()
    expect(calls).toEqual([`open ${projectRoot} ghostty`])
  })

  it("marks the finished session row completed with the badge of the account it ran on", async () => {
    await renderDesktopApp(app)
    await flush()

    await typeAndSend(app.container, "检查依赖")
    await flush()
    await flush()

    const row = app.container.querySelector<HTMLElement>(".proj-sessions .sess")
    expect(row?.dataset.status).toBe("completed")
    expect(row?.querySelector(".agent-icon-badge")).not.toBeNull()
    expect(row?.querySelector(".sess-agent")?.getAttribute("title")).toBe("工作号")
  })
})
