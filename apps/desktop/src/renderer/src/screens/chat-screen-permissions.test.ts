// 负责验证聊天页的权限控件：四档对应 Claude Code 模式，每个新会话默认监督审批、计划关闭，
// 计划开关独立并记住原档位，自动审批未接通时每次都如实提示。

// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { reduceSession, type SessionUiState } from "../models/session-model"
import {
  buttonNamed,
  chatScreenRoot,
  clickButton,
  sessionController,
  startingState,
  typeAndSend,
} from "../test-support/chat-screen-harness"

const screen = chatScreenRoot()

/** 打开模型选择器；权限档位和计划开关都在它的底栏里。已经打开时不再点，免得把它关掉。 */
async function openPicker(): Promise<void> {
  if (permissionButton()) return
  await clickButton(
    screen.container.querySelector<HTMLElement>(".model-chip") ?? undefined,
    "模型选择器",
  )
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

function liveIn(mode: SessionUiState["permissionMode"]): SessionUiState {
  return reduceSession(startingState(), { type: "mode-changed", mode })
}

function endedIn(mode: SessionUiState["permissionMode"]): SessionUiState {
  return reduceSession(liveIn(mode), { type: "stopped" })
}

describe("chat screen permission controls", () => {
  it("offers the four levels with supervised approval selected and the plan switch off", async () => {
    await screen.render()
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
    await screen.render({ session })

    await chooseLevel("接受编辑")
    await typeAndSend(screen.container, "开始吧")

    expect(session.start).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "acceptEdits" }),
    )
  })

  it("starts the session in plan mode while the draft plan switch is on", async () => {
    const session = sessionController()
    await screen.render({ session })

    await openPicker()
    await clickButton(planToggle() ?? undefined, "计划模式")
    await typeAndSend(screen.container, "先出个计划")

    expect(session.start).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: "plan" }))
  })

  it("asks before full access and keeps the level when the user cancels", async () => {
    const session = sessionController()
    await screen.render({ session })

    await chooseLevel("完全访问")
    expect(document.body.textContent).toContain("启用完全访问？")
    await clickButton(buttonNamed("取消"), "取消")
    await typeAndSend(screen.container, "开始吧")
    expect(session.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ permissionMode: "default" }),
    )

    await chooseLevel("完全访问")
    await clickButton(buttonNamed("启用完全访问"), "启用完全访问")
    await typeAndSend(screen.container, "再来")
    expect(session.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ permissionMode: "bypassPermissions" }),
    )
  })

  it("says so every time instead of pretending auto approval is on", async () => {
    const session = sessionController()
    await screen.render({ session })
    const notice = "自动审批暂未接通，已保持当前档位"

    await chooseLevel("自动审批")
    await chooseLevel("自动审批")

    expect(document.body.textContent?.split(notice).length).toBe(3)
    await openPicker()
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 监督审批")
    await typeAndSend(screen.container, "开始吧")
    expect(session.start).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "default" }),
    )
  })

  it("switches a live session into plan mode and back to the level it had before", async () => {
    const session = sessionController({ state: liveIn("acceptEdits") })
    await screen.render({ fresh: false, session })

    await openPicker()
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 接受编辑")
    await clickButton(planToggle() ?? undefined, "计划模式")
    expect(session.setMode).toHaveBeenLastCalledWith("plan")

    await screen.render({ fresh: false, session: { ...session, state: liveIn("plan") } })
    await openPicker()
    expect(planToggle()?.getAttribute("aria-pressed")).toBe("true")
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 接受编辑")
    await clickButton(planToggle() ?? undefined, "计划模式")
    expect(session.setMode).toHaveBeenLastCalledWith("acceptEdits")
  })

  it("only remembers a new level while plan mode is on, and applies it when plan ends", async () => {
    const session = sessionController({ state: liveIn("plan") })
    await screen.render({ fresh: false, session })

    await chooseLevel("接受编辑")
    expect(session.setMode).not.toHaveBeenCalled()
    await openPicker()
    await clickButton(planToggle() ?? undefined, "计划模式")
    expect(session.setMode).toHaveBeenLastCalledWith("acceptEdits")
  })

  it("starts the next session in supervised approval after one that ran at full access", async () => {
    const session = sessionController({ state: liveIn("default") })
    await screen.render({ fresh: false, session })

    await chooseLevel("完全访问")
    await clickButton(buttonNamed("启用完全访问"), "启用完全访问")
    expect(session.setMode).toHaveBeenLastCalledWith("bypassPermissions")

    await screen.render({
      fresh: false,
      session: { ...session, state: endedIn("bypassPermissions") },
    })
    await openPicker()
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 监督审批")
    await typeAndSend(screen.container, "下一个会话")
    expect(session.start).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "default" }),
    )
  })

  it("turns the plan switch off again for the session after a planned one", async () => {
    const session = sessionController()
    await screen.render({ session })
    await openPicker()
    await clickButton(planToggle() ?? undefined, "计划模式")
    await typeAndSend(screen.container, "先出个计划")
    expect(session.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ permissionMode: "plan" }),
    )

    await screen.render({ fresh: false, session: { ...session, state: liveIn("plan") } })
    await screen.render({ fresh: false, session: { ...session, state: endedIn("plan") } })
    await typeAndSend(screen.container, "再来")
    expect(session.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ permissionMode: "default" }),
    )
  })

  it("keeps the plan switch when the session's account has left the pool", async () => {
    const state = reduceSession(liveIn("default"), {
      type: "event",
      event: { type: "account-switched", from: "account-a", to: "account-gone", reason: "quota" },
    })
    await screen.render({ fresh: false, session: sessionController({ state }) })

    await openPicker()
    expect(planToggle()).not.toBeNull()
  })
})
