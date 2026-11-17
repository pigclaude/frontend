// 验证项目资料在右键菜单和草稿中打开，只有第二次明确确认才变更信任。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { expect, it, vi } from "vitest"
import type { ProjectConfigurationReport } from "../../project-configuration-contract"
import { DesktopApp } from "./app"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"

const app = desktopAppRoot()

it("在两个入口查看项目配置，并在确认前披露将运行的内容", async () => {
  installFakeDesktopBridge()
  let current: ProjectConfigurationReport = {
    workspace: "/work/web",
    trust: "untrusted",
    hasProjectSettings: true,
    instructions: ["CLAUDE.md"],
    counts: { commands: 1, skills: 1, agents: 0 },
    hooks: [{ event: "SessionStart", kind: "command", command: "node ./check-project.js" }],
    environment: ["PROJECT_TOKEN"],
    servers: [{ name: "local-search", command: "node" }],
    credentialScripts: [],
    skillExecution: [{ name: "audit", inline: true, hooks: false, allowedTools: true }],
    shadowedCommands: ["new"],
    unreadable: [],
  }
  let choice = true
  const report = vi.fn(async (path: string) => ({ ...current, workspace: path }))
  const prepare = vi.fn(async (path: string, trusted: boolean) => {
    choice = trusted
    return { id: `prepared:${path}`, trusted, report: current }
  })
  const confirm = vi.fn(async (id: string) => {
    expect(id).toBe("prepared:/work/web")
    current = { ...current, trust: choice ? "trusted" : "untrusted" }
    return current
  })
  if (!window.pigclaude) throw new Error("测试桌面桥未安装")
  window.pigclaude.projectConfiguration = { report, prepare, confirm }
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()

  const project = [...app.container.querySelectorAll<HTMLElement>("button.proj")].find(
    (item) => item.textContent?.trim() === "web",
  )
  if (!project) throw new Error("找不到 web 项目")
  await act(async () =>
    project.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 60,
        clientY: 140,
      }),
    ),
  )
  await flush()
  const entries = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  expect(entries.map((item) => item.textContent?.trim())).toEqual([
    "项目配置",
    "重命名",
    "在访达中打开",
    "从侧栏移除",
  ])
  await act(async () => entries[0]?.click())
  await flush()
  expect(report).toHaveBeenLastCalledWith("/work/web")
  expect(dialog().textContent).toContain("node ./check-project.js")
  expect(dialog().textContent).toContain("PROJECT_TOKEN")
  expect(dialog().textContent).toContain("/new")

  expect(dialog().textContent).toContain("在输入框输入 $ 可搜索并调用项目 skills。")
  await press(dialog(), "启用项目设置与 MCP")
  expect(prepare).toHaveBeenCalledWith("/work/web", true)
  expect(confirm).not.toHaveBeenCalled()
  await press(dialog(), "取消")
  expect(confirm).not.toHaveBeenCalled()
  await press(dialog(), "启用项目设置与 MCP")
  await press(dialog(), "确认启用")
  expect(confirm).toHaveBeenCalledOnce()
  expect(dialog().textContent).toContain("已启用")
  await press(dialog(), "关闭")

  const add = project.closest(".proj-row")?.querySelector<HTMLElement>(".proj-add")
  if (!add) throw new Error("找不到 web 草稿入口")
  await act(async () => add.click())
  await flush()
  await press(app.container, "项目信息")
  expect(report).toHaveBeenLastCalledWith("/work/web")
  expect(dialog().textContent).toContain("已启用")
  await press(dialog(), "停用项目设置与 MCP")
  expect(prepare).toHaveBeenLastCalledWith("/work/web", false)
  expect(confirm).toHaveBeenCalledOnce()
  await press(dialog(), "确认停用")
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(dialog().textContent).toContain("未启用")

  await press(dialog(), "关闭")
  current = { ...current, hasProjectSettings: false, hooks: [], environment: [], servers: [] }
  await press(app.container, "项目信息")
  expect(dialog().textContent).toContain("在输入框输入 $ 可搜索并调用项目 skills。")
  expect(dialog().textContent).not.toContain("启用项目设置与 MCP")
})

function dialog(): HTMLElement {
  const current = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!current) throw new Error("找不到项目配置对话框")
  return current
}

async function press(root: ParentNode, label: string): Promise<void> {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === label,
  )
  if (!button) throw new Error(`找不到按钮 ${label}`)
  await act(async () => button.click())
  await flush()
}
