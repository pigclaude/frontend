// 负责验证页面里的新会话默认设置：启动后读一次，所有使用者看到同一份；读取晚于保存回来时不覆盖新值。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initialMembershipView } from "../models/membership-view"
import { builtinSessionDefaults, type SessionDefaults } from "../../../session-defaults-contract"
import {
  resetSessionDefaultsForTest,
  useSessionDefaults,
  type SessionDefaultsController,
} from "./use-session-defaults"

let root: Root
let container: HTMLDivElement
let controller: SessionDefaultsController | null = null

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

function Probe({ name }: { name: string }) {
  const value = useSessionDefaults()
  if (name === "first") controller = value
  return createElement("span", { "data-probe": name }, value.defaults.permissionMode)
}

function shown(name: string): string | null | undefined {
  return container.querySelector(`[data-probe="${name}"]`)?.textContent
}

function installBridge(read: () => Promise<SessionDefaults>): void {
  let stored = builtinSessionDefaults
  window.pigclaude = {
    platform: "darwin",
    membership: {
      inspect: async () => initialMembershipView(),
      subscribe: () => () => undefined,
      withdraw: async () => initialMembershipView(),
      signOut: async () => initialMembershipView(),
    },
    sessionDefaults: {
      get: read,
      set: async (patch) => (stored = { ...stored, ...patch }),
    },
  }
}

async function renderProbes(): Promise<void> {
  await act(async () =>
    root.render([
      createElement(Probe, { key: "first", name: "first" }),
      createElement(Probe, { key: "second", name: "second" }),
    ]),
  )
}

describe("useSessionDefaults", () => {
  it("reads once and shares saved changes with every user", async () => {
    const read = vi.fn(async () => ({ ...builtinSessionDefaults, permissionMode: "auto" as const }))
    installBridge(read)
    await renderProbes()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(shown("second")).toBe("auto")

    await act(async () => controller?.save({ permissionMode: "acceptEdits" }))

    expect(shown("first")).toBe("acceptEdits")
    expect(shown("second")).toBe("acceptEdits")
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("keeps a change saved before the first read comes back", async () => {
    let finishRead: (value: SessionDefaults) => void = () => undefined
    installBridge(() => new Promise((resolve) => (finishRead = resolve)))
    await renderProbes()

    await act(async () => controller?.save({ permissionMode: "acceptEdits" }))
    await act(async () => finishRead({ ...builtinSessionDefaults, permissionMode: "auto" }))

    expect(shown("first")).toBe("acceptEdits")
  })
})
