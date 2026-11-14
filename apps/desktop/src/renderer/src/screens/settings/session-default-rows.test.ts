// 负责验证设置页的新会话默认值：模型、权限和账号的选择写进桌面桥，设为完全访问要先确认，
// 保存失败时提示且界面保持原值。

// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "../../app-providers"
import { resetSessionDefaultsForTest } from "../../hooks/use-session-defaults"
import { initialMembershipView } from "../../models/membership-view"
import { chooseSelect } from "../../test-support/base-ui-select"
import { chatAccount } from "../../test-support/chat-screen-harness"
import type { ClaudeModel } from "../../../../main/session/session-types"
import {
  builtinSessionDefaults,
  type SessionDefaults,
  type SessionDefaultsPatch,
} from "../../../../session-defaults-contract"
import { SwitchingSettings } from "./settings-account-pages"
import { SessionSettings } from "./settings-app-pages"
const models: ClaudeModel[] = [
  { id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true },
  { id: "claude-opus", displayName: "Opus", description: "", isDefault: false },
]

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.pigclaude
  resetSessionDefaultsForTest()
  vi.unstubAllGlobals()
})

function installDefaults(initial: SessionDefaults = builtinSessionDefaults) {
  let stored = initial
  const saves: SessionDefaultsPatch[] = []
  const state = { fail: false }
  window.pigclaude = {
    platform: "darwin",
    membership: {
      inspect: async () => initialMembershipView(),
      subscribe: () => () => undefined,
      withdraw: async () => initialMembershipView(),
      signOut: async () => initialMembershipView(),
    },
    sessionDefaults: {
      get: async () => stored,
      set: async (patch) => {
        if (state.fail) throw new Error("SESSION_DEFAULTS_FAILED")
        saves.push(patch)
        return (stored = { ...stored, ...patch })
      },
    },
  }
  return { saves, state }
}

async function render(children: ReactNode): Promise<void> {
  await act(async () => root.render(createElement(AppProviders, { children })))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function trigger(label: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!element) throw new Error(`没有找到 ${label}`)
  return element
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === name,
  )
  if (!found) throw new Error(`没有找到按钮 ${name}`)
  return found
}

describe("new session defaults in settings", () => {
  it("saves the chosen model and follows Claude Code when its default is chosen", async () => {
    const bridge = installDefaults()
    await render(createElement(SessionSettings, { models }))
    expect(trigger("默认模型").textContent).toBe("Sonnet")

    await chooseSelect(trigger("默认模型"), "Opus")
    expect(trigger("默认模型").textContent).toBe("Opus")
    await chooseSelect(trigger("默认模型"), "Sonnet")

    expect(bridge.saves).toEqual([{ model: "claude-opus" }, { model: null }])
  })

  it("keeps listing a stored model that left the catalog", async () => {
    installDefaults({ ...builtinSessionDefaults, model: "claude-retired" })
    await render(createElement(SessionSettings, { models }))

    expect(trigger("默认模型").textContent).toBe("claude-retired")

    await render(createElement(SessionSettings, { models: [] }))
    expect(container.textContent).toContain("默认模型claude-retired")
  })

  it("saves a permission level and asks before making full access the default", async () => {
    const bridge = installDefaults()
    await render(createElement(SessionSettings, { models }))
    expect(trigger("默认权限").textContent).toBe("监督审批")

    await chooseSelect(trigger("默认权限"), "接受编辑")
    expect(bridge.saves).toEqual([{ permissionMode: "acceptEdits" }])

    await chooseSelect(trigger("默认权限"), "完全访问")
    expect(document.body.textContent).toContain("把默认权限设为完全访问？")
    await act(async () => button("取消").click())
    expect(bridge.saves).toEqual([{ permissionMode: "acceptEdits" }])
    expect(trigger("默认权限").textContent).toBe("接受编辑")

    await chooseSelect(trigger("默认权限"), "完全访问")
    await act(async () => button("设为完全访问").click())
    expect(bridge.saves).toEqual([
      { permissionMode: "acceptEdits" },
      { permissionMode: "bypassPermissions" },
    ])
    expect(trigger("默认权限").textContent).toBe("完全访问")
  })

  it("tells the user when saving fails and keeps the previous value", async () => {
    const bridge = installDefaults()
    bridge.state.fail = true
    await render(createElement(SessionSettings, { models }))

    await chooseSelect(trigger("默认权限"), "自动审批")

    await vi.waitFor(() => expect(document.body.textContent).toContain("没能保存默认设置"))
    expect(trigger("默认权限").textContent).toBe("监督审批")
  })

  it("prefers a chosen account for new sessions and falls back to automatic", async () => {
    const bridge = installDefaults({ ...builtinSessionDefaults, accountId: "acc-deleted" })
    const accounts = [chatAccount("acc-work", "工作号"), chatAccount("acc-home", "个人号")]
    await render(createElement(SwitchingSettings, { accounts, onNavigate: () => undefined }))
    expect(trigger("新会话账号").textContent).toBe("自动选择账号")

    await chooseSelect(trigger("新会话账号"), "个人号")
    await chooseSelect(trigger("新会话账号"), "自动选择账号")

    expect(bridge.saves).toEqual([{ accountId: "acc-home" }, { accountId: null }])
  })
})
