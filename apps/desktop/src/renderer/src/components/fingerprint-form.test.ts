// 负责验证指纹表单组件：分组渲染、快捷预设、三态噪声、伪装多选、WebRTC、自定义分辨率和字段错误。

// @vitest-environment jsdom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { defaultFingerprintForm, type FingerprintFormErrors } from "../models/fingerprint-form"
import { FingerprintForm } from "./fingerprint-form"
import { chooseSelect } from "../test-support/base-ui-select"
import { fillFingerprintField } from "../test-support/fingerprint-input"

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
  errors?: FingerprintFormErrors | undefined
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
  await fillFingerprintField(container, selector.replace(/^#/, ""), value)
}

async function choose(selector: string, value: string): Promise<void> {
  await chooseSelect(query<HTMLElement>(selector), value)
}

describe("fingerprint form", () => {
  it("renders grouped settings with shadcn controls and concise product copy", async () => {
    await render()

    for (const title of ["身份与定位", "设备与网络", "隐私与兼容", "高级设置"]) {
      expect(container.textContent).toContain(title)
    }
    expect(query<HTMLElement>("#fp-preset").getAttribute("aria-label")).toBe("快捷预设")
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(9)
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect(query<HTMLElement>("#fp-seed").textContent).toBe("按配置自动生成")
    expect(query<HTMLElement>("#fp-lang").textContent).toBe("跟随系统语言")
    expect(query<HTMLElement>("#fp-timezone").textContent).toBe("跟随系统时区")
    expect(query<HTMLElement>("#fp-brand").textContent).toBe("Chrome")
    expect(query<HTMLElement>("#fp-platform").textContent).toBe("macOS")
    expect(container.querySelector("#fp-customResolution")).toBeNull()
    await click("#fp-group-advanced")
    expect(container.querySelector("#fp-unknownArgs")).not.toBeNull()
    // 9 个旧字段只保存和诊断，不作为独立可编辑控件。
    expect(container.querySelector("#fp-colorDepth")).toBeNull()
    expect(container.querySelector("#fp-webglRenderer")).toBeNull()
    expect(container.textContent).not.toContain("AntBrowser")
    expect(container.querySelector('select:not([aria-hidden="true"])')).toBeNull()
  })

  it("applies a quick preset without replacing the seed", async () => {
    await render({ ...defaultFingerprintForm(), seed: "777" })
    await choose("#fp-preset", "fp-preset-win-edge-enterprise")

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
    expect(query<HTMLElement>("#fp-brand").textContent).toBe("Edge")
    expect(query<HTMLElement>("#fp-preset").textContent).toBe("Windows · Edge 企业")
    await typeInto("#fp-lang", "en-US")
    expect(query<HTMLElement>("#fp-preset").textContent).toBe("自定义配置")
  })

  it("shows explicit defaults for empty browser and platform values", async () => {
    await render({ ...defaultFingerprintForm(), brand: "", platform: "" })
    expect(query<HTMLElement>("#fp-brand").textContent).toBe("跟随默认")
    expect(query<HTMLElement>("#fp-platform").textContent).toBe("跟随默认")
    await choose("#fp-brand", "Edge")
    await choose("#fp-brand", "跟随默认")
    expect(latest.brand).toBe("")
    await choose("#fp-platform", "Windows")
    await choose("#fp-platform", "跟随默认")
    expect(latest.platform).toBe("")
  })

  it("switches canvas and clientRects noise through all three states", async () => {
    await render()
    await click("#fp-group-compat")

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
    await click("#fp-group-compat")

    await act(async () => query<HTMLInputElement>("#fp-disableSpoofing-font").click())
    await act(async () => query<HTMLInputElement>("#fp-disableSpoofing-gpu").click())
    expect(latest.disableSpoofing).toEqual(["font", "gpu"])

    await act(async () => query<HTMLInputElement>("#fp-disableSpoofing-font").click())
    expect(latest.disableSpoofing).toEqual(["gpu"])
  })

  it("changes the WebRTC policy and the custom resolution", async () => {
    await render()
    await click("#fp-group-device")

    await choose("#fp-webrtcPolicy", "仅公网接口")
    expect(latest.webrtcPolicy).toBe("default_public_interface_only")

    await choose("#fp-resolution", "自定义")
    expect(container.querySelector("#fp-customResolution")).not.toBeNull()
    await typeInto("#fp-customResolution", "2560,1440")
    expect(latest.resolution).toBe("custom")
    expect(latest.customResolution).toBe("2560,1440")
    await choose("#fp-resolution", "跟随屏幕")
    expect(latest.resolution).toBe("")
    expect(container.querySelector("#fp-customResolution")).toBeNull()
    await choose("#fp-webrtcPolicy", "跟随默认")
    expect(latest.webrtcPolicy).toBe("")
  })

  it("edits unknown arguments as one value per line", async () => {
    await render()
    await click("#fp-group-advanced")

    await typeInto("#fp-unknownArgs", "--disable-gpu\n\n--js-flags=--max-old-space-size=4096")
    expect(latest.unknownArgs).toEqual([
      "--disable-gpu",
      "",
      "--js-flags=--max-old-space-size=4096",
    ])
  })

  it("removes all arguments when the user explicitly clears the ordinary field", async () => {
    await render({ ...defaultFingerprintForm(), unknownArgs: ["--profile-directory=.."] })
    await click("#fp-group-advanced")
    await typeInto("#fp-unknownArgs", "")
    expect(latest.unknownArgs).toEqual([])
  })

  it("edits and removes individual arguments while preserving another argument's line breaks", async () => {
    const multiline = "--custom=one\r\n--load-extension=/synthetic"
    await render({ ...defaultFingerprintForm(), unknownArgs: [multiline, "--other=one"] })
    await click("#fp-group-advanced")
    await typeInto("#fp-unknownArgs-2", "--other=two")
    expect(latest.unknownArgs).toEqual([multiline, "--other=two"])
    await click('[aria-label="添加原始参数"]')
    await click('[aria-label="删除原始参数 2"]')
    expect(latest.unknownArgs).toEqual([multiline, ""])
  })

  it("preserves existing CRLF and CR when editing the same argument", async () => {
    const multiline = "--custom=one\r\nmiddle\rend"
    await render({ ...defaultFingerprintForm(), unknownArgs: [multiline, "--other"] })
    await click("#fp-group-advanced")
    await typeInto("#fp-unknownArgs", "X--custom=one")
    expect(latest.unknownArgs).toEqual([`X${multiline}`, "--other"])
    await typeInto("#fp-unknownArgs-1-line-3", "end!")
    expect(latest.unknownArgs).toEqual([`X${multiline}!`, "--other"])
  })

  it("keeps focus and explains individual arguments when the last line break is removed", async () => {
    await render({ ...defaultFingerprintForm(), unknownArgs: ["--custom=one\ntwo", "--other"] })
    await click("#fp-group-advanced")
    const field = query<HTMLTextAreaElement>("#fp-unknownArgs")
    expect(query<HTMLElement>("#fp-unknownArgs-hint").textContent).toContain("每组是一条")
    expect(field.getAttribute("aria-describedby")).toContain("fp-unknownArgs-hint")
    await click('[aria-label="删除原始参数 1 的换行 1"]')
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe("--custom=onetwo")
    expect(query<HTMLTextAreaElement>("#fp-unknownArgs-2").value).toBe("--other")
  })

  it.each([
    { separator: 1, expected: "x\nz" },
    { separator: 2, expected: "x\r\nz" },
  ])(
    "removes the selected newline without changing an adjacent newline",
    async ({ separator, expected }) => {
      await render({ ...defaultFingerprintForm(), unknownArgs: ["x\r\n\nz"] })
      await click("#fp-group-advanced")
      await click(`[aria-label="删除原始参数 1 的换行 ${separator}"]`)
      expect(latest.unknownArgs).toEqual([expected])
    },
  )

  it("inserts a new line without changing existing separators and moves focus to it", async () => {
    await render({ ...defaultFingerprintForm(), unknownArgs: ["--custom=one\r\nlast"] })
    await click("#fp-group-advanced")
    await typeInto("#fp-unknownArgs", "--custom=one\ninserted")
    expect(latest.unknownArgs).toEqual(["--custom=one\ninserted\r\nlast"])
    const inserted = query<HTMLTextAreaElement>("#fp-unknownArgs-1-line-2")
    expect(document.activeElement).toBe(inserted)
    expect(inserted.selectionStart).toBe("inserted".length)
  })

  it("allows an existing single empty argument to be removed and focuses add", async () => {
    await render({ ...defaultFingerprintForm(), unknownArgs: [""] })
    await click("#fp-group-advanced")
    await click('[aria-label="删除原始参数 1"]')
    expect(latest.unknownArgs).toEqual([])
    expect(document.activeElement?.getAttribute("aria-label")).toBe("添加原始参数")
  })

  it("removes only the selected item from multiple existing empty arguments", async () => {
    await render({ ...defaultFingerprintForm(), unknownArgs: ["", ""] })
    await click("#fp-group-advanced")
    await click('[aria-label="删除原始参数 1"]')
    expect(latest.unknownArgs).toEqual([""])
    expect(document.activeElement?.getAttribute("aria-label")).toBe("原始参数 1 第 1 行")
  })

  it("can remove the remaining arguments after returning to the group", async () => {
    await render({
      ...defaultFingerprintForm(),
      unknownArgs: ["--custom=one\ntwo", "", "--profile-directory=.."],
    })
    await click("#fp-group-advanced")
    await click('[aria-label="删除原始参数 1"]')
    expect(latest.unknownArgs).toEqual(["", "--profile-directory=.."])
    await click("#fp-group-identity")
    await click("#fp-group-advanced")
    await click('[aria-label="删除原始参数 2"]')
    await click('[aria-label="删除原始参数 1"]')
    expect(latest.unknownArgs).toEqual([])
  })

  it("shows field-level errors under the matching field", async () => {
    await render(defaultFingerprintForm(), {
      seed: "种子必须是整数",
      timezone: "时区不可识别",
    })

    const alerts = [...container.querySelectorAll('[role="alert"]')].map((item) => item.textContent)
    expect(alerts).toContain("种子必须是整数")
    expect(alerts).toContain("时区不可识别")
    const row = query<HTMLElement>("#fp-timezone").closest(".item")
    expect(row).not.toBeNull()
    expect(query<HTMLElement>("#fp-timezone-error").closest(".item")).toBe(row)
  })

  it("lays out the active group as titled setting sections with label-left rows", async () => {
    await render()

    const titles = [...container.querySelectorAll(".fp-section .section-head h3")]
    expect(titles.map((title) => title.textContent)).toEqual([
      "浏览器",
      "系统",
      "语言与时区",
      "种子",
    ])
    const row = query<HTMLElement>("#fp-timezone").closest(".item")
    expect(row?.querySelector('label[for="fp-timezone"]')?.textContent).toBe("时区")
    expect(row?.querySelector("#fp-timezone-hint")).not.toBeNull()
    expect(row?.querySelector(".trail #fp-timezone")).not.toBeNull()
    const chips = [...container.querySelectorAll(".fp-chip")].map((chip) => chip.textContent)
    expect(chips).toEqual(["跟随系统语言", "系统时区", "种子自动"])
    expect(query<HTMLElement>(".fp-group-description").textContent).toBe(
      "设置网站读取到的浏览器、系统和地区信息。",
    )
    expect(container.querySelector(".fp-sidebar, .fp-field, label[for='fp-preset']")).toBeNull()
  })

  it("renders spoofing as one switch row per category under the section hint", async () => {
    await render()
    await click("#fp-group-compat")

    const group = query<HTMLElement>('[role="group"][aria-label="停用特征伪装"]')
    const labels = [...group.querySelectorAll(".item label")].map((label) => label.textContent)
    expect(labels).toEqual(["字体", "音频", "Canvas", "ClientRects", "GPU"])
    expect(container.querySelectorAll("#fp-disableSpoofing-hint")).toHaveLength(1)
    expect(query<HTMLElement>("#fp-disableSpoofing-hint").textContent).toBe(
      "打开开关后，对应特征使用原始值，适合排查页面兼容问题。",
    )
    expect(group.getAttribute("aria-describedby")).toContain("fp-disableSpoofing-hint")
    expect(query<HTMLElement>("#fp-canvasNoise").closest(".trail")).not.toBeNull()
    expect(container.querySelector(".fp-switches")).toBeNull()
  })

  it("opens the group containing an invalid hidden field and preserves drafts across groups", async () => {
    await render(defaultFingerprintForm(), { hardwareConcurrency: "核心数不合法" })
    expect(query<HTMLElement>("#fp-group-device").getAttribute("aria-checked")).toBe("true")
    expect(container.textContent).toContain("核心数不合法")
    expect(query<HTMLElement>("#fp-hardwareConcurrency").getAttribute("aria-invalid")).toBe("true")

    await click("#fp-group-identity")
    await typeInto("#fp-seed", "654321")
    await click("#fp-group-advanced")
    await typeInto("#fp-unknownArgs", "--disable-gpu")
    await click("#fp-group-identity")
    expect(query<HTMLInputElement>("#fp-seed-custom").value).toBe("654321")
    expect(latest.unknownArgs).toEqual(["--disable-gpu"])
  })

  it("selects locale, versions and hardware without typing and can restore automatic values", async () => {
    await render()
    await choose("#fp-brandVersion", "147")
    await choose("#fp-platformVersion", "15.2.0")
    await choose("#fp-lang", "日本語（ja-JP）")
    await choose("#fp-timezone", "东京（Asia/Tokyo）")
    await choose("#fp-acceptLang", "日本語（ja-JP）优先")
    await click("#fp-group-device")
    await choose("#fp-hardwareConcurrency", "16 核")
    expect(latest).toMatchObject({
      brandVersion: "147",
      platformVersion: "15.2.0",
      lang: "ja-JP",
      timezone: "Asia/Tokyo",
      acceptLang: "ja-JP,ja",
      hardwareConcurrency: "16",
    })
    await choose("#fp-hardwareConcurrency", "使用默认核心数")
    await click("#fp-group-identity")
    await choose("#fp-timezone", "跟随系统时区")
    expect(latest.timezone).toBe("")
    expect(latest.hardwareConcurrency).toBe("")
  })

  it("preserves an existing custom version after changing the platform or applying a preset", async () => {
    await render({ ...defaultFingerprintForm(), platformVersion: "custom-linux-version" })
    expect(query<HTMLInputElement>("#fp-platformVersion-custom").value).toBe("custom-linux-version")
    await choose("#fp-platform", "Windows")
    expect(latest.platformVersion).toBe("custom-linux-version")
    await choose("#fp-preset", "fp-preset-jp-mac-chrome-light")
    expect(query<HTMLElement>("#fp-platformVersion").textContent).toBe("15.2.0")
    expect(container.querySelector("#fp-platformVersion-custom")).toBeNull()
  })

  it("generates a seed only on explicit choice and keeps it stable while editing other fields", async () => {
    await render()
    expect(latest.seed).toBe("")
    await choose("#fp-seed", "生成新种子")
    const generated = latest.seed
    expect(Number(generated)).toBeGreaterThanOrEqual(1)
    expect(Number(generated)).toBeLessThanOrEqual(2_147_483_647)
    expect(query<HTMLInputElement>("#fp-seed-custom").value).toBe(generated)
    await choose("#fp-lang", "简体中文（zh-CN）")
    expect(latest.seed).toBe(generated)
    await choose("#fp-seed", "按配置自动生成")
    expect(latest.seed).toBe("")
    expect(container.querySelector("#fp-seed-custom")).toBeNull()
  })
})
