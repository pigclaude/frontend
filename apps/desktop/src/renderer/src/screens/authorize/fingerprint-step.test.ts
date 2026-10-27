// 负责验证授权向导的指纹步骤：受控草稿、完整对象提交、字段错误、预设应用、后端错误和返回上一步。

// @vitest-environment jsdom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { defaultFingerprintForm } from "../../models/fingerprint-form"
import { FingerprintStep, type FingerprintStepProps } from "./fingerprint-step"
import { chooseSelect } from "../../test-support/radix-select"
import { fillFingerprintField } from "../../test-support/fingerprint-input"

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

/** 模拟授权页持有草稿；步骤本身只受控渲染。 */
function Harness(
  props: Omit<FingerprintStepProps, "value" | "onChange"> & { initial: ClaudeFingerprintView },
) {
  const [value, setValue] = useState(props.initial)
  return createElement(FingerprintStep, {
    ...props,
    value,
    onChange: (next: ClaudeFingerprintView) => setValue(next),
  })
}

async function render(props: {
  initial?: ClaudeFingerprintView
  submitLabel?: string
  error?: string | null
  onSubmit: (fingerprint: ClaudeFingerprintView) => void
  onBack?: () => void
}): Promise<void> {
  await act(async () =>
    root.render(
      createElement(Harness, {
        initial: props.initial ?? defaultFingerprintForm(),
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
  await fillFingerprintField(container, id, value)
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

    const preset = container.querySelector<HTMLElement>("#step-preset")
    expect(preset).not.toBeNull()
    if (preset) await chooseSelect(preset, "step-preset-mac-chrome-jp")
    await clickId("step-group-compat")
    await clickId("step-canvasNoise-0")
    await clickText("保存并确认")

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        seed: "",
        platform: "macos",
        platformVersion: "",
        lang: "ja-JP",
        acceptLang: "",
        timezone: "Asia/Tokyo",
        resolution: "1440,900",
        hardwareConcurrency: "8",
        canvasNoise: "0",
        clientRectsNoise: "1",
        disableSpoofing: [],
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
