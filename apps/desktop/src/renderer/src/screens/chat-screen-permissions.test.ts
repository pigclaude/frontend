// 负责验证聊天页的权限控件：四档（含自动审批）对应 Claude Code 模式，每个新会话默认监督审批、计划关闭，
// 计划开关（含 /plan 命令）独立并记住原档位；会话中的档位以主进程报告为准，批准计划前先回到原档位。

// @vitest-environment jsdom
import { act } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, type Mock } from "vitest"
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
  return reduceSession(startingState(), {
    type: "event",
    event: { type: "mode", permissionMode: mode },
  })
}

function endedIn(mode: SessionUiState["permissionMode"]): SessionUiState {
  return reduceSession(liveIn(mode), { type: "stopped" })
}

/** 计划模式下 Claude Code 交出计划、等待批准的会话。 */
function planWaitingForApproval(): SessionUiState {
  return reduceSession(liveIn("plan"), {
    type: "event",
    event: {
      type: "permission",
      requestId: "plan-1",
      toolName: "ExitPlanMode",
      input: { plan: "先改测试再实现" },
    },
  })
}

function composerEditor(): HTMLElement {
  const editor = screen.container.querySelector<HTMLElement>(".composer .tiptap")
  expect(editor, "输入区").not.toBeNull()
  return editor!
}

async function pressShiftTab(): Promise<void> {
  const editor = composerEditor()
  await act(async () => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    )
  })
}

/** 在输入区敲一条斜杠命令，等命令列表出来后用回车执行。 */
async function runCommand(command: string): Promise<void> {
  const editor = composerEditor()
  const user = userEvent.setup()
  await act(async () => {
    await user.click(editor)
    await user.type(editor, command)
  })
  await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
  await act(async () => {
    await user.keyboard("{Enter}")
  })
}

async function choosePromptOption(index: number): Promise<void> {
  const option = screen.container.querySelectorAll<HTMLElement>('[role="option"]')[index]
  await clickButton(option, `权限选项 ${index}`)
}

function callOrder(fn: Mock, call: "first" | "last"): number {
  const order = fn.mock.invocationCallOrder
  return (call === "first" ? order[0] : order.at(-1)) ?? Number.NaN
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

  it("starts the session asking Claude Code for auto approval", async () => {
    const session = sessionController()
    await screen.render({ session })

    await chooseLevel("自动审批")
    await typeAndSend(screen.container, "开始吧")

    expect(session.start).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: "auto" }))
  })

  it("asks a live session for auto approval and shows the level Claude Code reports", async () => {
    const session = sessionController({ state: liveIn("default") })
    await screen.render({ fresh: false, session })

    await chooseLevel("自动审批")
    expect(session.setMode).toHaveBeenLastCalledWith("auto")
    await openPicker()
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 监督审批")

    await screen.render({ fresh: false, session: { ...session, state: liveIn("auto") } })
    await openPicker()
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 自动审批")
  })

  it("remembers the level Claude Code ran at, not a refused one, when Claude Code enters plan mode", async () => {
    const session = sessionController({ state: liveIn("default") })
    await screen.render({ fresh: false, session })
    await chooseLevel("自动审批")
    expect(session.setMode).toHaveBeenLastCalledWith("auto")

    await screen.render({ fresh: false, session: { ...session, state: liveIn("plan") } })
    await openPicker()
    expect(permissionButton()?.getAttribute("aria-label")).toBe("权限: 监督审批")
    await clickButton(planToggle() ?? undefined, "计划模式")
    expect(session.setMode).toHaveBeenLastCalledWith("default")
  })

  it("cycles supervised approval, accept edits and auto approval with Shift+Tab", async () => {
    const session = sessionController({ state: liveIn("acceptEdits") })
    await screen.render({ fresh: false, session })

    await pressShiftTab()
    expect(session.setMode).toHaveBeenLastCalledWith("auto")

    await screen.render({ fresh: false, session: { ...session, state: liveIn("auto") } })
    await pressShiftTab()
    expect(session.setMode).toHaveBeenLastCalledWith("default")
  })

  it("returns to the level it had before plan mode, then approves the plan", async () => {
    const session = sessionController({ state: liveIn("acceptEdits") })
    await screen.render({ fresh: false, session })
    await openPicker()
    await clickButton(planToggle() ?? undefined, "计划模式")
    expect(session.setMode).toHaveBeenLastCalledWith("plan")

    await screen.render({ fresh: false, session: { ...session, state: planWaitingForApproval() } })
    await choosePromptOption(0)

    expect(session.setMode).toHaveBeenLastCalledWith("acceptEdits")
    expect(session.respondPermission).toHaveBeenCalledWith("plan-1", "allow", undefined)
    expect(callOrder(session.setMode as Mock, "last")).toBeLessThan(
      callOrder(session.respondPermission as Mock, "first"),
    )
  })

  it("stays in plan mode when the plan is sent back", async () => {
    const session = sessionController({ state: planWaitingForApproval() })
    await screen.render({ fresh: false, session })

    await choosePromptOption(1)
    await clickButton(buttonNamed("确认"), "确认")

    expect(session.respondPermission).toHaveBeenCalledWith("plan-1", "deny", undefined)
    expect(session.setMode).not.toHaveBeenCalled()
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

  it("opens and closes plan mode with the /plan command", async () => {
    const session = sessionController({ state: liveIn("acceptEdits") })
    await screen.render({ fresh: false, session })

    await runCommand("/plan")
    expect(session.setMode).toHaveBeenLastCalledWith("plan")

    await screen.render({ fresh: false, session: { ...session, state: liveIn("plan") } })
    await runCommand("/plan")
    expect(session.setMode).toHaveBeenLastCalledWith("acceptEdits")
    expect(session.send).not.toHaveBeenCalled()
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
