// 负责验证指纹表单模型：字段元数据覆盖、8+5 预设、默认值、归一化、中文校验和摘要分组。

import { describe, expect, it } from "vitest"
import {
  defaultClaudeFingerprint,
  type FingerprintNoise,
  type FingerprintSpoofingCategory,
  type FingerprintWebrtcPolicy,
} from "@pigclaude/contracts/claude-account"
import {
  advancedFingerprintProfiles,
  applyFingerprintPreset,
  defaultFingerprintForm,
  fingerprintFieldMeta,
  fingerprintGroups,
  fingerprintPreset,
  fingerprintResolutionPresets,
  fingerprintSummaryGroups,
  formatUnknownArgs,
  hasFingerprintFormErrors,
  normalizeFingerprintForm,
  parseUnknownArgs,
  quickFingerprintPresets,
  validateFingerprintForm,
} from "./fingerprint-form"

describe("fingerprint form metadata", () => {
  it("covers every contract field exactly once across the four groups", () => {
    const grouped = fingerprintGroups.flatMap((group) => group.fields)
    expect(grouped).toHaveLength(25)
    expect(new Set(grouped).size).toBe(25)
    expect([...grouped].sort()).toEqual(Object.keys(defaultFingerprintForm()).sort())
    expect(Object.keys(fingerprintFieldMeta).sort()).toEqual([...grouped].sort())
    expect(fingerprintGroups.map((group) => group.title)).toEqual([
      "身份与定位",
      "设备与网络",
      "兼容伪装",
      "高级原始参数",
    ])
  })

  it("uses the contract default instead of hard-coded locale values", () => {
    expect(defaultFingerprintForm()).toEqual(defaultClaudeFingerprint())
    expect(defaultFingerprintForm()).toMatchObject({
      seed: "",
      lang: "",
      timezone: "",
      canvasNoise: "",
      clientRectsNoise: "",
      disableSpoofing: [],
    })
  })
})

describe("fingerprint presets", () => {
  it("exposes the eight quick presets and five advanced profiles by id", () => {
    expect(quickFingerprintPresets.map((preset) => preset.id)).toEqual([
      "win-chrome-office",
      "win-chrome-gaming",
      "mac-chrome-designer",
      "win-edge-enterprise",
      "win-chrome-us-user",
      "mac-chrome-jp",
      "win-chrome-uk-office",
      "mac-chrome-us-edu",
    ])
    expect(advancedFingerprintProfiles.map((preset) => preset.id)).toEqual([
      "us-win-chrome-office",
      "jp-mac-chrome-light",
      "uk-win-edge-enterprise",
      "sg-win-chrome-business",
      "de-linux-chrome-dev",
    ])
    expect(fingerprintPreset("win-chrome-jp")).toBeNull()
  })

  it("fills a complete fingerprint and keeps the current seed when applied", () => {
    const jp = fingerprintPreset("mac-chrome-jp")
    expect(jp).not.toBeNull()
    if (jp === null) return
    expect(jp.fingerprint).toMatchObject({
      seed: "",
      brand: "Chrome",
      platform: "macos",
      platformVersion: "15.0.0",
      lang: "ja-JP",
      acceptLang: "ja-JP,ja",
      timezone: "Asia/Tokyo",
      resolution: "1440,900",
      hardwareConcurrency: "8",
      canvasNoise: "1",
      clientRectsNoise: "1",
      disableSpoofing: [],
      unknownArgs: [],
    })
    const applied = applyFingerprintPreset({ ...defaultFingerprintForm(), seed: "998877" }, jp)
    expect(applied.seed).toBe("998877")
    expect(applied.timezone).toBe("Asia/Tokyo")
    expect(applied.lang).toBe("ja-JP")
  })

  it("keeps the disable-spoofing combination in the edge enterprise profile", () => {
    const edge = fingerprintPreset("uk-win-edge-enterprise")
    expect(edge?.fingerprint).toMatchObject({
      brand: "Edge",
      platform: "windows",
      lang: "en-GB",
      timezone: "Europe/London",
      webrtcPolicy: "default_public_interface_only",
      disableSpoofing: ["font"],
    })
  })
})

describe("fingerprint normalization", () => {
  it("trims text, normalizes the mac alias and sorts spoofing categories", () => {
    const normalized = normalizeFingerprintForm({
      ...defaultFingerprintForm(),
      seed: "  123  ",
      platform: " Mac ",
      lang: " ja-JP ",
      acceptLang: " ja-JP , ja ",
      disableSpoofing: ["gpu", "font", "gpu"] as FingerprintSpoofingCategory[],
      unknownArgs: [" --foo ", "", "--bar"],
    })
    expect(normalized).toMatchObject({
      seed: "123",
      platform: "macos",
      lang: "ja-JP",
      acceptLang: "ja-JP,ja",
      disableSpoofing: ["font", "gpu"],
      unknownArgs: ["--foo", "--bar"],
    })
  })

  it("fills every optional field and normalizes legacy boolean noise", () => {
    const normalized = normalizeFingerprintForm({
      seed: "",
      brand: "Chrome",
      platform: "macos",
      lang: "",
      timezone: "",
      canvasNoise: true as unknown as FingerprintNoise,
      clientRectsNoise: false as unknown as FingerprintNoise,
    })
    expect(normalized).toEqual({
      ...defaultClaudeFingerprint(),
      canvasNoise: "1",
      clientRectsNoise: "0",
    })
  })

  it("parses and formats unknown arguments one per line", () => {
    expect(parseUnknownArgs("--a\n\n  --b  \n")).toEqual(["--a", "--b"])
    expect(formatUnknownArgs(["--a", "--b"])).toBe("--a\n--b")
    expect(formatUnknownArgs(undefined)).toBe("")
  })
})

describe("fingerprint validation", () => {
  const base = defaultFingerprintForm()

  it("accepts the AntBrowser default and a valid custom resolution", () => {
    expect(validateFingerprintForm(base)).toEqual({})
    expect(
      validateFingerprintForm({
        ...base,
        seed: "2147483647",
        timezone: "system",
        resolution: "custom",
        customResolution: "2560,1440",
        hardwareConcurrency: "128",
        disableSpoofing: ["font", "audio", "canvas", "clientrects", "gpu"],
      }),
    ).toEqual({})
  })

  it("reports Chinese errors for seeds, versions, languages and time zones", () => {
    const errors = validateFingerprintForm({
      ...base,
      seed: "0",
      brand: "Firefox",
      brandVersion: "144.x",
      platform: "android",
      platformVersion: "15 0",
      lang: "english!",
      acceptLang: "en-US,!!",
      timezone: "Mars/Olympus",
    })
    expect(errors).toMatchObject({
      seed: "指纹种子必须是 1 到 2147483647 的整数",
      brand: "浏览器品牌仅支持 Chrome、Edge、Opera、Vivaldi",
      brandVersion: "品牌版本必须是数字点分格式，例如 144.0.7559.132",
      platform: "平台仅支持 windows、linux、macos",
      platformVersion: "系统版本只能包含字母、数字、点、横线和下划线",
      lang: "语言格式不正确，例如 zh-CN 或 en-US",
      acceptLang: "Accept-Language 必须是逗号分隔的语言列表，例如 zh-CN,zh",
      timezone: "时区不是当前系统可识别的 IANA 名称",
    })
  })

  it("reports Chinese errors for resolution, CPU, WebRTC, noise, spoofing and args", () => {
    const errors = validateFingerprintForm({
      ...base,
      resolution: "1280,720",
      customResolution: "100,100",
      hardwareConcurrency: "129",
      webrtcPolicy: "bogus" as FingerprintWebrtcPolicy,
      canvasNoise: "2" as FingerprintNoise,
      clientRectsNoise: "3" as FingerprintNoise,
      disableSpoofing: ["font", "webgl"] as unknown as FingerprintSpoofingCategory[],
      unknownArgs: [1] as unknown as string[],
    })
    expect(errors).toMatchObject({
      resolution: "分辨率必须是预设值，或选择自定义后填写宽高",
      hardwareConcurrency: "CPU 核心数必须是 1 到 128 的整数",
      webrtcPolicy: "WebRTC 策略仅支持三个固定取值或留空",
      canvasNoise: "Canvas 噪声只能是空、0 或 1",
      clientRectsNoise: "ClientRects 噪声只能是空、0 或 1",
      disableSpoofing: "禁用伪装类别必须来自字体、音频、Canvas、ClientRects、GPU",
      unknownArgs: "原始参数必须是字符串数组",
    })
    expect(
      validateFingerprintForm({ ...base, resolution: "custom", customResolution: "100,100" }),
    ).toMatchObject({ customResolution: "自定义分辨率必须是宽,高，宽高都不小于 200" })
    expect(hasFingerprintFormErrors(errors)).toBe(true)
    expect(hasFingerprintFormErrors({})).toBe(false)
    expect(fingerprintResolutionPresets).toContain("1920,1080")
  })
})

describe("fingerprint summary", () => {
  it("groups identity, device, compatibility and advanced values", () => {
    const groups = fingerprintSummaryGroups({
      ...defaultFingerprintForm(),
      seed: "520117",
      platform: "linux",
      platformVersion: "6.8.0",
      lang: "de-DE",
      timezone: "Europe/Berlin",
      canvasNoise: "0",
      clientRectsNoise: "1",
      webrtcPolicy: "disable_non_proxied_udp",
      disableSpoofing: ["font", "audio"],
      unknownArgs: ["--disable-gpu"],
      colorDepth: "24",
    })
    expect(groups.map((group) => group.title)).toEqual([
      "身份与定位",
      "设备与网络",
      "兼容伪装",
      "高级原始参数",
    ])
    const text = JSON.stringify(groups)
    expect(text).toContain("520117")
    expect(text).toContain("Linux 6.8.0")
    expect(text).toContain("de-DE")
    expect(text).toContain("Europe/Berlin")
    expect(text).toContain("关闭")
    expect(text).toContain("开启")
    expect(text).toContain("禁用非代理 UDP")
    expect(text).toContain("字体、音频")
    expect(text).toContain("--disable-gpu")
    expect(text).toContain("色彩深度")
  })

  it("shows follow-the-default labels for an empty fingerprint", () => {
    const text = JSON.stringify(fingerprintSummaryGroups(undefined))
    expect(text).toContain("按账号 ID 生成")
    expect(text).toContain("跟随系统语言")
    expect(text).toContain("系统时区")
    expect(text).toContain("不输出（跟随默认）")
    expect(text).toContain("不额外禁用")
  })
})
