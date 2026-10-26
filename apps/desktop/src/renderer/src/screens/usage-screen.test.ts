// 负责验证用量页：从 usage.summary 读取今天和 7 天汇总、空态不伪造数字、错误可读且页面不出现凭据。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UsageBridge, UsageSummary } from "../../../main/session/session-types"
import { UsageScreen } from "./usage-screen"

const summary: UsageSummary = {
  requests: 12,
  inputTokens: 1_240,
  outputTokens: 860,
  cacheReadTokens: 320,
  cacheCreationTokens: 90,
  averageDurationMs: 3_900,
  errors: 1,
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
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

async function render(bridge: UsageBridge): Promise<void> {
  await act(async () => {
    root.render(createElement(UsageScreen, { bridge }))
  })
  await act(async () => undefined)
}

function button(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
}

describe("usage screen", () => {
  it("shows the today summary from the usage bridge", async () => {
    const summaryMock = vi.fn(async () => summary)
    await render({ summary: summaryMock })

    expect(summaryMock).toHaveBeenCalledWith({ range: "today" })
    expect(container.textContent).toContain("12")
    expect(container.textContent).toContain("1.2K")
    expect(container.textContent).toContain("860")
    expect(container.textContent).toContain("3.9s")
    expect(container.textContent).not.toContain("312")
  })

  it("switches to the seven day range", async () => {
    const summaryMock = vi.fn(async () => summary)
    await render({ summary: summaryMock })

    await act(async () => button("7 天")?.click())
    await act(async () => undefined)

    expect(summaryMock).toHaveBeenLastCalledWith({ range: "7d" })
  })

  it("shows an empty state instead of fabricated numbers", async () => {
    await render({
      summary: async () => ({
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        averageDurationMs: 0,
        errors: 0,
      }),
    })

    expect(container.textContent).toContain("还没有用量记录")
    expect(container.textContent).not.toContain("312")
    expect(container.textContent).not.toContain("1.24M")
  })

  it("shows the mapped error when the usage bridge fails", async () => {
    await render({
      summary: async () => {
        throw new Error("SDK_ERROR: 用量记录尚未准备好")
      },
    })

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Claude 返回错误")
  })

  it("never puts credentials into the page or localStorage", async () => {
    await render({ summary: async () => summary })

    const page = `${container.innerHTML}${JSON.stringify({ ...window.localStorage })}`
    expect(page).not.toMatch(/accessToken|refreshToken|sk-ant-|Bearer /)
  })
})
