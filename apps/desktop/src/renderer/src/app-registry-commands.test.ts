// 负责验证注册表命令接进输入框和命令面板：`/new` 与「新会话」、`/panel` 与 ⌘J 行为一致，
// 命令面板里有开合右侧面板，输入框的 `/` 菜单列出的就是注册表里的命令。
// @vitest-environment jsdom
import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DesktopApp } from "./app"
import { typeAndSend } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({
    resolved: "dark",
    settings: { smartPunctuation: false },
    update: () => undefined,
  }),
}))

const app = desktopAppRoot()

function editor(): HTMLElement {
  const found = app.container.querySelector<HTMLElement>(".composer .tiptap")
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
  const slot = app.container.querySelector(".right-panel-slot")
  return slot !== null && !slot.hasAttribute("hidden")
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
  installFakeDesktopBridge()
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
}

describe("registry commands", () => {
  it("lists /new and /panel from the registry in the composer's / menu", async () => {
    await render()

    const listed = await runSlash("")
    expect(listed.some((text) => text.includes("/new"))).toBe(true)
    expect(listed.some((text) => text.includes("/panel"))).toBe(true)
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
    const screen = () => app.container.querySelector<HTMLElement>("[data-main-window]")?.dataset
    const openSession = async () => {
      const row = app.container.querySelector<HTMLButtonElement>(".proj-sessions .sess")
      await act(async () => row?.click())
      await flush()
    }
    expect(screen()?.screen).toBe("chat")

    await runSlash("new")
    expect(screen()?.screen).toBe("chat-new")

    await openSession()
    expect(screen()?.screen).toBe("chat")
    const newSession = app.container.querySelector<HTMLButtonElement>("button.new-thread-btn")
    await act(async () => newSession?.click())
    await flush()
    expect(screen()?.screen).toBe("chat-new")
  })

  it("offers toggling the right panel in the command palette", async () => {
    await render()
    const search = app.container.querySelector<HTMLButtonElement>('button[aria-label="搜索"]')
    await act(async () => search?.click())
    await flush()

    expect(document.body.textContent).toContain("显示或隐藏右侧面板")
  })
})
