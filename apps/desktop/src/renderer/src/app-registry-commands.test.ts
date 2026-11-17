// 负责验证注册表命令接进输入框和命令面板：`/new` 与「新会话」、`/panel` 与 ⌘J 行为一致，
// 命令面板里有开合右侧面板，输入框的 `/` 菜单列出的就是注册表里的命令。
// @vitest-environment jsdom
import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DesktopApp } from "./app"
import { typeAndSend } from "./test-support/chat-screen-harness"
import {
  desktopAppRoot,
  flush,
  installFakeDesktopBridge,
  renderDesktopApp,
} from "./test-support/desktop-app-harness"

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({
    resolved: "dark",
    settings: { smartPunctuation: false },
    update: () => undefined,
  }),
}))

const app = desktopAppRoot()

function editor(): HTMLElement {
  const found = app.container.querySelector<HTMLElement>('[contenteditable="true"]')
  if (!found) throw new Error("没有输入区")
  return found
}

/** 在输入区敲 `/名字`，等 `/` 菜单出现后按回车执行第一项；返回菜单里列出的命令。 */
async function runSlash(name: string): Promise<string[]> {
  const user = userEvent.setup()
  await act(async () => {
    await user.click(editor())
    await user.type(editor(), `/${name}`)
  })
  await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
  const listed = [...document.querySelectorAll('[role="option"]')].map(
    (option) => option.textContent ?? "",
  )
  await act(async () => {
    await user.keyboard("{Enter}")
  })
  await flush()
  return listed
}

function rightPanelOpen(): boolean {
  const toggle = app.container.querySelector('button[aria-label="切换右侧面板"]')
  return toggle?.getAttribute("aria-pressed") === "true"
}

function screen(): string | undefined {
  return app.container.querySelector<HTMLElement>("[data-main-window]")?.dataset.screen
}

/** 打开命令面板并执行名字为 title 的命令。 */
async function runFromPalette(title: string): Promise<void> {
  const search = app.container.querySelector<HTMLButtonElement>('button[aria-label="搜索"]')
  await act(async () => search?.click())
  await flush()
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.includes(title),
  )
  if (!option) throw new Error(`命令面板里没有 ${title}`)
  await act(async () => option.click())
  await flush()
}

async function pressModJ(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true, cancelable: true }),
    )
  })
  await flush()
}

async function render(): Promise<void> {
  await renderDesktopApp(app)
}

describe("registry commands", () => {
  it("loads the draft project's Claude commands and inserts the selected command", async () => {
    const fake = installFakeDesktopBridge(["/work/api"])
    const session = window.pigclaude?.session
    if (!session) throw new Error("缺少测试会话桥")
    const commands = vi.fn(async () => [
      { name: "inspect", text: "/inspect", kind: "skill" as const },
    ])
    session.commands = commands
    await act(async () => app.root.render(createElement(DesktopApp)))
    await flush()

    const listed = await runSlash("inspect")
    expect(listed).toEqual([expect.stringContaining("/inspect")])
    expect(commands).toHaveBeenCalledWith({ workspace: "/work/api" })
    expect(editor().textContent?.trim()).toBe("/inspect")
    expect(fake.starts).toEqual([])
  })

  it.each(["$", "¥", "￥"])("在草稿输入框用 %s 按项目查找并插入 skill", async (trigger) => {
    const fake = installFakeDesktopBridge(["/work/api"])
    const session = window.pigclaude?.session
    if (!session) throw new Error("缺少测试会话桥")
    const commands = vi.fn(async () => [
      { name: "fixture-check", kind: "skill" as const, text: "$fixture-check", scope: "project" },
    ])
    session.commands = commands
    await act(async () => app.root.render(createElement(DesktopApp)))
    await flush()

    const user = userEvent.setup()
    await act(async () => user.type(editor(), "请运行 " + trigger + "fixture"))
    await vi.waitFor(
      () =>
        expect(document.querySelector('[role="option"]')?.textContent).toContain("fixture-check"),
      { timeout: 1_000 },
    )
    await act(async () => user.keyboard("{Enter}"))
    expect(editor().textContent?.trim()).toBe("请运行 $fixture-check")
    expect(commands).toHaveBeenCalledWith({ workspace: "/work/api" })
    expect(fake.starts).toHaveLength(0)
  })
  it("lists /new and /panel from the registry in the composer's / menu", async () => {
    await render()

    const listed = await runSlash("")
    expect(listed.some((text) => text.includes("/new"))).toBe(true)
    expect(listed.some((text) => text.includes("/panel"))).toBe(true)
  })

  it("输入 /matt 同时列出项目和个人 skill，选择个人项后插入原生提及", async () => {
    installFakeDesktopBridge(["/work/api"])
    const session = window.pigclaude?.session
    if (!session) throw new Error("缺少测试会话桥")
    session.commands = async () => [
      { name: "ask-matt", text: "$ask-matt", kind: "skill", scope: "project" },
      { name: "mattpocock-skills:pr", text: "/mattpocock-skills:pr", kind: "skill" },
      {
        name: "mattpocock-skills:pr",
        text: "$mattpocock-skills:pr",
        kind: "skill",
        scope: "user",
        path: "/user/.claude/plugins/cache/mattpocock/skills/pr/SKILL.md",
      },
    ]
    await act(async () => app.root.render(createElement(DesktopApp)))
    await flush()
    const user = userEvent.setup()
    await act(async () => user.type(editor(), "/matt"))
    const item = await vi.waitFor(
      () => {
        const items = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        expect(items).toHaveLength(2)
        expect(items.some((row) => row.textContent?.includes("/skill:ask-matt"))).toBe(true)
        const personal = items.find((row) =>
          row.textContent?.includes("/skill:mattpocock-skills:pr"),
        )
        expect(personal?.textContent).toContain("个人")
        if (!personal) throw new Error("缺少个人 skill")
        return personal
      },
      { timeout: 1_000 },
    )
    await act(async () => user.click(item))
    expect(editor().textContent?.trim()).toBe("$mattpocock-skills:pr")
  })

  it("按新建会话快捷键时重新聚焦已有草稿", async () => {
    await render()
    expect(screen()).toBe("chat-new")
    await act(async () => {
      editor().blur()
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true, cancelable: true }),
      )
    })
    await vi.waitFor(() => expect(document.activeElement).toBe(editor()))
  })

  it("/panel toggles the right panel like ⌘J", async () => {
    await render()

    await pressModJ()
    expect(rightPanelOpen()).toBe(true)
    await runSlash("panel")
    expect(rightPanelOpen()).toBe(false)
    await runSlash("panel")
    expect(rightPanelOpen()).toBe(true)
    await pressModJ()
    expect(rightPanelOpen()).toBe(false)
  })

  it("/new goes to the new-session draft like the New session command", async () => {
    await render()
    await typeAndSend(app.container, "检查依赖")
    await flush()
    await flush()
    const openSession = async () => {
      const row = [...app.container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) =>
          button.getAttribute("aria-current") === null && button.textContent?.includes("检查依赖"),
      )
      await act(async () => row?.click())
      await flush()
    }
    expect(screen()).toBe("chat")
    expect(app.container.querySelector('.panel-top [role="tab"]')?.textContent).toBe("检查依赖")

    await runSlash("new")
    expect(screen()).toBe("chat-new")

    await openSession()
    expect(screen()).toBe("chat")
    await runFromPalette("新会话")
    expect(screen()).toBe("chat-new")
  })

  it("toggles the right panel from the command palette like ⌘J", async () => {
    await render()

    await runFromPalette("显示或隐藏右侧面板")
    expect(rightPanelOpen()).toBe(true)
    await pressModJ()
    expect(rightPanelOpen()).toBe(false)
  })
})
