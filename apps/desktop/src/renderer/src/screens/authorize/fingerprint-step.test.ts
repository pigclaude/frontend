// 负责验证授权向导的指纹步骤：完整对象提交、字段级错误、预设应用、后端错误显示和返回上一步。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { defaultFingerprintForm } from "../../models/fingerprint-form"
import { FingerprintStep } from "./fingerprint-step"

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
  vi.unstubAllGlobals()
})

async function render(props: {
  initialFingerprint?: ClaudeFingerprintView
  submitLabel?: string
  error?: string | null
  onSubmit: (fingerprint: ClaudeFingerprintView) => void
  onBack?: () => void
}): Promise<void> {
  await act(async () =>
    root.render(
      createElement(FingerprintStep, {
        initialFingerprint: props.initialFingerprint ?? defaultFingerprintForm(),
        submitLabel: props.submitLabel ?? "保存并确认",
        error: props.error ?? null,
        idPrefix: "step",
        onSubmit: props.onSubmit,
        onBack: props.onBack,
      }),
    ),
  )
}

async function clickText(text: string): Promise<void> {
  const target = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  )
  expect(target, text).toBeDefined()
  await act(async () => target?.click())
}

async function clickId(id: string): Promise<void> {
  const target = container.querySelector<HTMLButtonElement>(`#${id}`)
  expect(target, id).not.toBeNull()
  await act(async () => target?.click())
}

async function type(id: string, value: string): Promise<void> {
  const element = container.querySelector<HTMLInputElement>(`#${id}`)
  expect(element, id).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value)
    element?.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("fingerprint step", () => {
  it("submits the normalized complete fingerprint", async () => {
    const onSubmit = vi.fn()
    await render({ onSubmit })
    await clickText("保存并确认")

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(defaultFingerprintForm())
  })

  it("stays on the step and shows field errors until the seed is valid", async () => {
    const onSubmit = vi.fn()
    await render({ onSubmit })

    await type("step-seed", "not-a-seed")
    await clickText("保存并确认")
    expect(onSubmit).not.toHaveBeenCalled()
    expect(container.textContent).toContain("指纹种子必须是 1 到 2147483647 的整数")

    await type("step-seed", "123")
    await clickText("保存并确认")
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ seed: "123" }))
  })

  it("submits preset fields and tri-state noise from the form", async () => {
    const onSubmit = vi.fn()
    await render({ onSubmit })

    await clickId("step-preset-mac-chrome-jp")
    await clickId("step-canvasNoise-0")
    await clickText("保存并确认")

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        seed: "",
        platform: "macos",
        lang: "ja-JP",
        timezone: "Asia/Tokyo",
        canvasNoise: "0",
        clientRectsNoise: "1",
      }),
    )
  })

  it("shows a backend error and the back entry", async () => {
    const onSubmit = vi.fn()
    const onBack = vi.fn()
    await render({ onSubmit, onBack, error: "主进程拒绝了这份指纹" })

    expect(container.textContent).toContain("主进程拒绝了这份指纹")
    await clickText("返回上一步")
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
