// 负责验证会话提示弹成通知：新提示弹一次，重新渲染不重复，同样的话再次出现会再弹。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocaleProvider } from "@pigclaude/ui-primitives"
import { ToastProvider } from "@pigclaude/ui-shell"
import type { SessionNotice } from "../models/session-model"
import { useSessionNotices } from "./use-session-notices"

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
})

function Probe({ notice }: { notice: SessionNotice | null }): null {
  useSessionNotices(notice)
  return null
}

async function render(notice: SessionNotice | null): Promise<void> {
  const probe = createElement(Probe, { notice })
  const element = createElement(LocaleProvider, {
    locale: "zh-CN",
    children: createElement(ToastProvider, { children: probe }),
  })
  await act(async () => root?.render(element))
}

function shownCount(message: string): number {
  return (document.body.textContent ?? "").split(message).length - 1
}

describe("useSessionNotices", () => {
  it("shows each new notice once, including a repeat of the same text", async () => {
    const message = "自动审批不可用：当前模型不支持。会话按监督审批运行。"
    const first = { message }

    await render(null)
    await render(first)
    await render(first)
    expect(shownCount(message)).toBe(1)

    await render({ message })
    expect(shownCount(message)).toBe(2)
  })
})
