// 负责验证账号详情里的指纹摘要：四组标题、种子兜底、噪声三态、WebRTC、伪装类别和旧字段。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { defaultFingerprintForm, advancedFingerprintProfiles } from "../models/fingerprint-form"
import { FingerprintSummary } from "./fingerprint-summary"

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

async function render(fingerprint?: ClaudeFingerprintView, fallbackSeed?: string): Promise<void> {
  await act(async () =>
    root.render(createElement(FingerprintSummary, { fingerprint, fallbackSeed })),
  )
}

describe("fingerprint summary", () => {
  it("renders the four AntBrowser groups and the full profile", async () => {
    const de = advancedFingerprintProfiles.find((preset) => preset.id === "de-linux-chrome-dev")
    expect(de).not.toBeNull()
    if (de === undefined) return
    await render({ ...de.fingerprint, seed: "520117", colorDepth: "24" })

    for (const title of ["身份与定位", "设备与网络", "兼容伪装", "高级原始参数"]) {
      expect(container.textContent).toContain(title)
    }
    expect(container.textContent).toContain("520117")
    expect(container.textContent).toContain("Chrome（跟随默认版本）")
    expect(container.textContent).toContain("Linux")
    expect(container.textContent).toContain("de-DE")
    expect(container.textContent).toContain("Europe/Berlin")
    expect(container.textContent).toContain("1920,1080")
    expect(container.textContent).toContain("12")
    expect(container.textContent).toContain("禁用非代理 UDP")
    expect(container.textContent).toContain("开启")
    expect(container.textContent).toContain("不额外禁用")
    expect(container.textContent).toContain("色彩深度")
    expect(container.textContent).toContain("24")
    expect(container.textContent).toContain("AntBrowser 1.8.0 不作为独立运行参数")
    expect(container.textContent).toContain("无")
  })

  it("shows follow-the-default labels and the legacy seed fallback", async () => {
    await render(defaultFingerprintForm(), "778899")

    expect(container.textContent).toContain("778899")
    expect(container.textContent).toContain("跟随系统语言")
    expect(container.textContent).toContain("系统时区")
    expect(container.textContent).toContain("按窗口自动")
    expect(container.textContent).toContain("不输出（跟随默认）")
    expect(container.textContent).toContain("不额外禁用")
    expect(container.textContent).toContain("无")
  })

  it("shows the custom resolution and unknown args as block values", async () => {
    await render({
      ...defaultFingerprintForm(),
      resolution: "custom",
      customResolution: "2560,1440",
      unknownArgs: ["--disable-gpu", "--js-flags=--max-old-space-size=4096"],
    })

    expect(container.textContent).toContain("2560,1440")
    expect(container.textContent).toContain("--disable-gpu --js-flags=--max-old-space-size=4096")
  })
})
