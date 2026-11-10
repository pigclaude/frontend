// 负责验证指纹表单模型：可编辑字段元数据、13 个预设权威值、默认值、归一化、中文校验和摘要分组。

import { describe, expect, it } from "vitest"
import {
  defaultClaudeFingerprint,
  type ClaudeFingerprintView,
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
  fingerprintLegacyFields,
  fingerprintResolutionPresets,
  fingerprintSummaryGroups,
  formatUnknownArgs,
  hasFingerprintFormErrors,
  normalizeFingerprintForm,
  prepareFingerprintSubmission,
  quickFingerprintPresets,
  validateFingerprintForm,
  type FingerprintPreset,
} from "./fingerprint-form"

describe("fingerprint form metadata", () => {
  it("keeps the nine legacy fields out of the editable groups", () => {
    const grouped = fingerprintGroups.flatMap((group) => group.fields)
    const legacyKeys = fingerprintLegacyFields.map((field) => field.key)
    expect(grouped).toHaveLength(16)
    expect(new Set(grouped).size).toBe(16)
    expect(grouped).not.toContain("colorDepth")
    expect(grouped).not.toContain("webglRenderer")
    expect(Object.keys(fingerprintFieldMeta).sort()).toEqual([...grouped].sort())
    expect([...grouped, ...legacyKeys].sort()).toEqual(Object.keys(defaultFingerprintForm()).sort())
    expect(fingerprintGroups.map((group) => group.title)).toEqual([
      "身份与定位",
      "设备与网络",
      "隐私与兼容",
      "高级设置",
    ])
    expect(fingerprintGroups.find((group) => group.id === "advanced")?.fields).toEqual([
      "unknownArgs",
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

/** 按 id 取预设；测试数据固定，缺失时直接失败。 */
function presetById(id: string): FingerprintPreset {
  const preset = [...quickFingerprintPresets, ...advancedFingerprintProfiles].find(
    (candidate) => candidate.id === id,
  )
  expect(preset, id).toBeDefined()
  return preset as FingerprintPreset
}

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
  })

  // 权威表：AntBrowser 1.8.0 快速预设和高级画像的逐字段值。
  const presetTable: { id: string; expected: Partial<ClaudeFingerprintView> }[] = [
    {
      id: "win-chrome-office",
      expected: {
        brand: "Chrome",
        platform: "windows",
        lang: "zh-CN",
        timezone: "Asia/Shanghai",
        resolution: "1920,1080",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "win-chrome-gaming",
      expected: {
        brand: "Chrome",
        platform: "windows",
        lang: "en-US",
        timezone: "America/New_York",
        resolution: "2560,1440",
        hardwareConcurrency: "16",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "mac-chrome-designer",
      expected: {
        brand: "Chrome",
        platform: "macos",
        lang: "zh-CN",
        timezone: "Asia/Shanghai",
        resolution: "2560,1440",
        hardwareConcurrency: "10",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "win-edge-enterprise",
      expected: {
        brand: "Edge",
        platform: "windows",
        lang: "zh-CN",
        timezone: "Asia/Shanghai",
        resolution: "1366,768",
        hardwareConcurrency: "4",
        webrtcPolicy: "default_public_interface_only",
      },
    },
    {
      id: "win-chrome-us-user",
      expected: {
        brand: "Chrome",
        platform: "windows",
        lang: "en-US",
        timezone: "America/Los_Angeles",
        resolution: "1920,1080",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "mac-chrome-jp",
      expected: {
        brand: "Chrome",
        platform: "macos",
        lang: "ja-JP",
        timezone: "Asia/Tokyo",
        resolution: "1440,900",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "win-chrome-uk-office",
      expected: {
        brand: "Chrome",
        platform: "windows",
        lang: "en-GB",
        timezone: "Europe/London",
        resolution: "1920,1080",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "mac-chrome-us-edu",
      expected: {
        brand: "Chrome",
        platform: "macos",
        lang: "en-US",
        timezone: "America/New_York",
        resolution: "1440,900",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "us-win-chrome-office",
      expected: {
        brand: "Chrome",
        platform: "windows",
        platformVersion: "10.0.0",
        lang: "en-US",
        timezone: "America/New_York",
        resolution: "1920,1080",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "jp-mac-chrome-light",
      expected: {
        brand: "Chrome",
        platform: "macos",
        platformVersion: "15.2.0",
        lang: "ja-JP",
        timezone: "Asia/Tokyo",
        resolution: "1440,900",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "uk-win-edge-enterprise",
      expected: {
        brand: "Edge",
        platform: "windows",
        platformVersion: "10.0.0",
        lang: "en-GB",
        timezone: "Europe/London",
        resolution: "1920,1080",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "sg-win-chrome-business",
      expected: {
        brand: "Chrome",
        platform: "windows",
        platformVersion: "10.0.0",
        lang: "en-SG",
        timezone: "Asia/Singapore",
        resolution: "1920,1080",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
    {
      id: "de-linux-chrome-dev",
      expected: {
        brand: "Chrome",
        platform: "linux",
        lang: "de-DE",
        timezone: "Europe/Berlin",
        resolution: "1920,1080",
        hardwareConcurrency: "12",
        webrtcPolicy: "disable_non_proxied_udp",
      },
    },
  ]

  it.each(presetTable)("matches every field of $id", ({ id, expected }) => {
    const preset = presetById(id)
    const defaults = defaultClaudeFingerprint()
    const complete = {
      ...defaults,
      acceptLang: "",
      canvasNoise: "1",
      clientRectsNoise: "1",
      ...expected,
    }
    for (const key of Object.keys(defaults) as (keyof ClaudeFingerprintView)[]) {
      expect(preset.fingerprint[key], `${id}.${key}`).toEqual(complete[key])
    }
    // 禁止字段：种子、品牌版本、语言列表、禁用伪装类别都不能由预设写入。
    expect(preset.fingerprint.seed).toBe("")
    expect(preset.fingerprint.brandVersion).toBe("")
    expect(preset.fingerprint.acceptLang).toBe("")
    expect(preset.fingerprint.disableSpoofing).toEqual([])
    if (preset.tier === "quick") expect(preset.fingerprint.platformVersion).toBe("")
  })

  it("keeps the seed, raw args and legacy fields when applying a preset", () => {
    const current = {
      ...defaultFingerprintForm(),
      seed: "998877",
      timezone: "Europe/Berlin",
      unknownArgs: ["--disable-gpu"],
      colorDepth: "24",
      fontList: "Arial",
    }
    const applied = applyFingerprintPreset(current, presetById("mac-chrome-jp"))
    expect(applied.seed).toBe("998877")
    expect(applied.unknownArgs).toEqual(["--disable-gpu"])
    expect(applied.colorDepth).toBe("24")
    expect(applied.fontList).toBe("Arial")
    expect(applied.lang).toBe("ja-JP")
    expect(applied.timezone).toBe("Asia/Tokyo")
    expect(applied.canvasNoise).toBe("1")
  })
})

describe("fingerprint normalization", () => {
  it("normalizes managed fields while preserving raw argument strings", () => {
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
      unknownArgs: [" --foo ", "", "--bar"],
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

  it("formats unknown arguments one per line", () => {
    expect(formatUnknownArgs(["--a", "--b"])).toBe("--a\n--b")
    expect(formatUnknownArgs(undefined)).toBe("")
  })

  it("prepares a normalized submission or returns field errors", () => {
    const valid = prepareFingerprintSubmission({ ...defaultFingerprintForm(), seed: " 123 " })
    expect(valid).toEqual({ ok: true, fingerprint: expect.objectContaining({ seed: "123" }) })
    for (const seed of ["0", "9007199254740993", "18446744073709551615"]) {
      expect(prepareFingerprintSubmission({ ...defaultFingerprintForm(), seed })).toEqual({
        ok: true,
        fingerprint: expect.objectContaining({ seed }),
      })
    }
    const invalid = prepareFingerprintSubmission({
      ...defaultFingerprintForm(),
      seed: "18446744073709551616",
    })
    expect(invalid).toEqual({
      ok: false,
      errors: { seed: "指纹种子必须是 0 到 18446744073709551615 的整数" },
    })
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
      seed: "18446744073709551616",
      brand: "Firefox",
      brandVersion: "144.x",
      platform: "android",
      platformVersion: "15 0",
      lang: "english!",
      acceptLang: "en-US,!!",
      timezone: "Mars/Olympus",
    })
    expect(errors).toMatchObject({
      seed: "指纹种子必须是 0 到 18446744073709551615 的整数",
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
      "隐私与兼容",
      "高级设置",
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
    expect(text).toContain("兼容字段从旧配置保留，不单独影响浏览器启动")
  })

  it("shows follow-the-default labels for an empty fingerprint", () => {
    const text = JSON.stringify(fingerprintSummaryGroups(undefined))
    expect(text).toContain("按浏览器配置生成")
    expect(text).toContain("跟随系统语言")
    expect(text).toContain("系统时区")
    expect(text).toContain("跟随默认")
    expect(text).toContain("不额外禁用")
  })
})
