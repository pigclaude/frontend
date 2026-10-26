// 负责验证指纹表单组件：分组渲染、快捷预设、三态噪声、伪装多选、WebRTC、自定义分辨率和字段错误。

// @vitest-environment jsdom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { defaultFingerprintForm, type FingerprintFormErrors } from "../models/fingerprint-form"
import { FingerprintForm } from "./fingerprint-form"

let root: Root
let container: HTMLDivElement
let latest: ClaudeFingerprintView

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  latest = defaultFingerprintForm()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function Harness({
  initial,
  errors,
  onChange,
}: {
  initial: ClaudeFingerprintView
  errors?: FingerprintFormErrors
  onChange: (value: ClaudeFingerprintView) => void
}) {
  const [value, setValue] = useState(initial)
  return createElement(FingerprintForm, {
    value,
    errors,
    idPrefix: "fp",
    onChange: (next: ClaudeFingerprintView) => {
      setValue(next)
      latest = next
      onChange(next)
    },
  })
}

async function render(
  initial: ClaudeFingerprintView = defaultFingerprintForm(),
  errors?: FingerprintFormErrors,
  onChange: (value: ClaudeFingerprintView) => void = () => undefined,
): Promise<void> {
  latest = initial
  await act(async () => root.render(createElement(Harness, { initial, errors, onChange })))
}

function query<T extends Element>(selector: string): T {
  const element = container.querySelector<T>(selector)
  expect(element, selector).not.toBeNull()
  return element as T
}

async function click(selector: string): Promise<void> {
  await act(async () => query<HTMLButtonElement>(selector).click())
}

async function typeInto(selector: string, value: string): Promise<void> {
  const element = query<HTMLInputElement | HTMLTextAreaElement>(selector)
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function choose(selector: string, value: string): Promise<void> {
  const element = query<HTMLSelectElement>(selector)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value)
    element.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("fingerprint form", () => {
  it("renders every group, preset and control id", async () => {
    await render()

    for (const title of [
      "快速生成",
      "高级画像",
      "身份与定位",
      "设备与网络",
      "兼容伪装",
      "高级原始参数",
    ]) {
      expect(container.textContent).toContain(title)
    }
    expect(container.querySelectorAll("button[id^='fp-preset-']")).toHaveLength(13)
    expect(query<HTMLInputElement>("#fp-seed").value).toBe("")
    expect(query<HTMLInputElement>("#fp-lang").value).toBe("")
    expect(query<HTMLInputElement>("#fp-timezone").value).toBe("")
    expect(query<HTMLSelectElement>("#fp-brand").value).toBe("Chrome")
    expect(query<HTMLSelectElement>("#fp-platform").value).toBe("macos")
    expect(container.querySelector("#fp-customResolution")).toBeNull()
    expect(container.querySelector("#fp-unknownArgs")).not.toBeNull()
    // 9 个旧字段只保存和诊断，不作为独立可编辑控件。
    expect(container.querySelector("#fp-colorDepth")).toBeNull()
    expect(container.querySelector("#fp-webglRenderer")).toBeNull()
    expect(container.textContent).toContain("本地内核生效")
  })

  it("applies a quick preset without replacing the seed", async () => {
    await render({ ...defaultFingerprintForm(), seed: "777" })
    await click("#fp-preset-win-edge-enterprise")

    expect(latest.seed).toBe("777")
    expect(latest.brand).toBe("Edge")
    expect(latest.platform).toBe("windows")
    expect(latest.lang).toBe("zh-CN")
    expect(latest.timezone).toBe("Asia/Shanghai")
    expect(latest.resolution).toBe("1366,768")
    expect(latest.hardwareConcurrency).toBe("4")
    expect(latest.acceptLang).toBe("")
    expect(latest.brandVersion).toBe("")
    expect(latest.platformVersion).toBe("")
    expect(latest.disableSpoofing).toEqual([])
    expect(latest.webrtcPolicy).toBe("default_public_interface_only")
    expect(query<HTMLSelectElement>("#fp-brand").value).toBe("Edge")
  })

  it("switches canvas and clientRects noise through all three states", async () => {
    await render()

    await click("#fp-canvasNoise-1")
    expect(latest.canvasNoise).toBe("1")
    await click("#fp-canvasNoise-0")
    expect(latest.canvasNoise).toBe("0")
    await click("#fp-canvasNoise-empty")
    expect(latest.canvasNoise).toBe("")

    await click("#fp-clientRectsNoise-0")
    expect(latest.clientRectsNoise).toBe("0")
  })

  it("toggles every disable-spoofing category independently", async () => {
    await render()

    await act(async () => query<HTMLInputElement>("#fp-disableSpoofing-font").click())
    await act(async () => query<HTMLInputElement>("#fp-disableSpoofing-gpu").click())
    expect(latest.disableSpoofing).toEqual(["font", "gpu"])

    await act(async () => query<HTMLInputElement>("#fp-disableSpoofing-font").click())
    expect(latest.disableSpoofing).toEqual(["gpu"])
  })

  it("changes the WebRTC policy and the custom resolution", async () => {
    await render()

    await choose("#fp-webrtcPolicy", "default_public_interface_only")
    expect(latest.webrtcPolicy).toBe("default_public_interface_only")

    await choose("#fp-resolution", "custom")
    expect(container.querySelector("#fp-customResolution")).not.toBeNull()
    await typeInto("#fp-customResolution", "2560,1440")
    expect(latest.resolution).toBe("custom")
    expect(latest.customResolution).toBe("2560,1440")
  })

  it("edits unknown arguments as one value per line", async () => {
    await render()

    await typeInto("#fp-unknownArgs", "--disable-gpu\n\n--js-flags=--max-old-space-size=4096")
    expect(latest.unknownArgs).toEqual([
      "--disable-gpu",
      "",
      "--js-flags=--max-old-space-size=4096",
    ])
  })

  it("shows field-level errors under the matching field", async () => {
    await render(defaultFingerprintForm(), {
      seed: "种子必须是整数",
      timezone: "时区不可识别",
    })

    const alerts = [...container.querySelectorAll('[role="alert"]')].map((item) => item.textContent)
    expect(alerts).toContain("种子必须是整数")
    expect(alerts).toContain("时区不可识别")
  })
})
