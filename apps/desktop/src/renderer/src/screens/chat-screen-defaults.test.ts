// 负责验证聊天页使用新会话默认设置的边界：草稿按默认模型和默认档位启动，会话结束后的新草稿重新取默认值；
// 默认档位只给新会话：默认值已读到后从别的页面回到开着计划的进行中会话，关掉计划不会借默认值进入完全访问。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { resetSessionDefaultsForTest } from "../hooks/use-session-defaults"
import { initialMembershipView } from "../models/membership-view"
import { reduceSession, type SessionUiState } from "../models/session-model"
import {
  chatScreenRoot,
  clickButton,
  sessionController,
  sessionTime,
  startingState,
  typeAndSend,
} from "../test-support/chat-screen-harness"
import { builtinSessionDefaults, type SessionDefaults } from "../../../session-defaults-contract"

const screen = chatScreenRoot()

afterEach(() => {
  delete window.pigclaude
  resetSessionDefaultsForTest()
})

function installDefaults(defaults: Partial<SessionDefaults>): void {
  window.pigclaude = {
    platform: "darwin",
    membership: {
      inspect: async () => initialMembershipView(),
      subscribe: () => () => undefined,
      withdraw: async () => initialMembershipView(),
      signOut: async () => initialMembershipView(),
    },
    sessionDefaults: {
      get: async () => ({ ...builtinSessionDefaults, ...defaults }),
      set: async () => {
        throw new Error("not used")
      },
    },
  }
}

async function settle(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function liveIn(mode: SessionUiState["permissionMode"]): SessionUiState {
  return reduceSession(startingState(), {
    type: "event",
    at: sessionTime,
    event: { type: "mode", permissionMode: mode },
  })
}

const models = [
  { id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true },
  { id: "claude-opus", displayName: "Opus", description: "", isDefault: false },
]

describe("chat screen with new session defaults", () => {
  it("starts a draft with the default model and full access chosen in settings", async () => {
    installDefaults({ model: "claude-opus", permissionMode: "bypassPermissions" })
    const session = sessionController({ models })
    await screen.render({ session })
    await settle()

    await typeAndSend(screen.container, "开始吧")

    expect(session.start).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus", permissionMode: "bypassPermissions" }),
    )
  })

  it("starts the draft after an ended session from the defaults again", async () => {
    installDefaults({ permissionMode: "acceptEdits" })
    const session = sessionController({ state: liveIn("bypassPermissions") })
    await screen.render({ fresh: false, session })
    await settle()

    const ended = reduceSession(liveIn("bypassPermissions"), { type: "stopped", at: sessionTime })
    await screen.render({ session: { ...session, state: ended } })
    await typeAndSend(screen.container, "下一个")

    expect(session.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ permissionMode: "acceptEdits" }),
    )
  })

  it("does not reach full access by ending plan mode in a live session after the default changed", async () => {
    installDefaults({ permissionMode: "bypassPermissions" })
    await screen.render()
    await settle()
    await screen.renderElement(createElement("div"))
    const session = sessionController({ state: liveIn("plan") })
    await screen.render({ fresh: false, session })

    await clickButton(
      screen.container.querySelector<HTMLElement>(".model-chip") ?? undefined,
      "模型选择器",
    )
    await clickButton(
      document.querySelector<HTMLElement>('button[aria-label="计划模式"]') ?? undefined,
      "计划模式",
    )

    expect(session.setMode).toHaveBeenLastCalledWith("default")
  })
})
