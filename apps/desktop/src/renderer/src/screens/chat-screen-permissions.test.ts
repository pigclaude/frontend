// 负责验证聊天页的权限控件：四档对应 Claude Code 模式，新会话默认监督审批，计划开关独立并记住原档位。

// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetComposerMemory } from "@pigclaude/ui-composer"
import { reduceSession, type SessionUiState } from "../models/session-model"
import {
  chatScreenElement,
  clickButton,
  sessionController,
  startingState,
  typeAndSend,
} from "../test-support/chat-screen-harness"
import type { ChatScreenProps } from "./chat-screen"

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  resetComposerMemory()
  window.localStorage.clear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(overrides: Partial<ChatScreenProps> = {}): Promise<void> {
  await act(async () => root.render(chatScreenElement(overrides)))
}

/** 打开模型选择器；权限档位和计划开关都在它的底栏里。已经打开时不再点，免得把它关掉。 */
async function openPicker(): Promise<void> {
  if (permissionButton()) return
  await clickButton(container.querySelector<HTMLElement>(".model-chip") ?? undefined, "模型选择器")
}

function permissionButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(".model-permission-btn")
}

function planToggle(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="计划模式"]')
}

async function chooseLevel(label: string): Promise<void> {
  await openPicker()
  await clickButton(permissionButton() ?? undefined, "权限按钮")
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
    (candidate) => candidate.textContent?.startsWith(label),
  )
  await clickButton(item, label)
}

function documentButton(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
}

function liveIn(mode: SessionUiState["permissionMode"]): SessionUiState {
  return reduceSession(startingState(), { type: "mode-changed", mode })
}

describe("chat screen permission controls", () => {
  it("offers the four levels with supervised approval selected and the plan switch off", async () => {
    await render()
    await openPicker()

    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 监督审批")
    expect(planToggle()?.getAttribute("aria-pressed")).toBe("false")
    await clickButton(permissionButton() ?? undefined, "权限按钮")
    const levels = [...document.querySelectorAll('[role="menuitemradio"]')].map(
      (item) => item.querySelector(".grow > span")?.textContent,
    )
    expect(levels).toEqual(["监督审批", "接受编辑", "自动审批", "完全访问"])
  })

  it("starts the session in the Claude Code mode of the chosen level", async () => {
    const session = sessionController()
    await render({ session })

    await chooseLevel("接受编辑")
    await typeAndSend(container, "开始吧")

    expect(session.start).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "acceptEdits" }),
    )
  })

  it("starts the session in plan mode while the draft plan switch is on", async () => {
    const session = sessionController()
    await render({ session })

    await openPicker()
    await clickButton(planToggle() ?? undefined, "计划模式")
    await typeAndSend(container, "先出个计划")

    expect(session.start).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: "plan" }))
  })

  it("asks before full access and keeps the level when the user cancels", async () => {
    const session = sessionController()
    await render({ session })

    await chooseLevel("完全访问")
    expect(document.body.textContent).toContain("启用完全访问？")
    await clickButton(documentButton("取消"), "取消")
    await typeAndSend(container, "开始吧")
    expect(session.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ permissionMode: "default" }),
    )

    await chooseLevel("完全访问")
    await clickButton(documentButton("启用完全访问"), "启用完全访问")
    await typeAndSend(container, "再来")
    expect(session.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ permissionMode: "bypassPermissions" }),
    )
  })

  it("says so instead of pretending auto approval is on", async () => {
    const session = sessionController()
    await render({ session })

    await chooseLevel("自动审批")

    expect(document.body.textContent).toContain("自动审批暂未接通，已保持当前档位")
    await openPicker()
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 监督审批")
    await typeAndSend(container, "开始吧")
    expect(session.start).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "default" }),
    )
  })

  it("switches a live session into plan mode and back to the level it had before", async () => {
    const session = sessionController({ state: liveIn("acceptEdits") })
    await render({ fresh: false, session })

    await openPicker()
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 接受编辑")
    await clickButton(planToggle() ?? undefined, "计划模式")
    expect(session.setMode).toHaveBeenLastCalledWith("plan")

    await render({ fresh: false, session: { ...session, state: liveIn("plan") } })
    await openPicker()
    expect(planToggle()?.getAttribute("aria-pressed")).toBe("true")
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 接受编辑")
    await clickButton(planToggle() ?? undefined, "计划模式")
    expect(session.setMode).toHaveBeenLastCalledWith("acceptEdits")
  })

  it("only remembers a new level while plan mode is on, and applies it when plan ends", async () => {
    const session = sessionController({ state: liveIn("plan") })
    await render({ fresh: false, session })

    await chooseLevel("接受编辑")
    expect(session.setMode).not.toHaveBeenCalled()
    await openPicker()
    await clickButton(planToggle() ?? undefined, "计划模式")
    expect(session.setMode).toHaveBeenLastCalledWith("acceptEdits")
  })
})
