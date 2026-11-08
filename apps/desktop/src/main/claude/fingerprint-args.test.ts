// 指纹参数测试。对照 AntBrowser 1.8.0 的 B() 锁定 flag 顺序，覆盖校验、空值、稳定种子和旧字段兼容。

import { describe, expect, it } from "vitest"
import {
  defaultClaudeFingerprint,
  type ClaudeFingerprintView,
  type FingerprintNoise,
  type FingerprintSpoofingCategory,
  type FingerprintWebrtcPolicy,
} from "@pigclaude/contracts/claude-account"
import {
  acceptLanguage,
  buildFingerprintArgs,
  defaultWindowSize,
  ensureFingerprint,
  normalizePlatform,
  resolveTimezone,
  validateFingerprint,
} from "./fingerprint-args"

/** 构造一份完整默认值的指纹，测试只覆盖关心的字段。 */
function fingerprint(overrides: Partial<ClaudeFingerprintView> = {}): ClaudeFingerprintView {
  return {
    ...defaultClaudeFingerprint(),
    seed: "123456",
    brand: "Chrome",
    platform: "macos",
    lang: "zh-CN",
    timezone: "Asia/Shanghai",
    ...overrides,
  }
}

describe("buildFingerprintArgs", () => {
  it("matches AntBrowser 1.8.0 flag set and order for a full fingerprint", () => {
    const value = fingerprint({
      brandVersion: "144.0.7559.132",
      platformVersion: "10.15.7",
      acceptLang: "zh-CN,zh",
      resolution: "1920,1080",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "0",
      disableSpoofing: ["font", "gpu"],
      unknownArgs: ["--foo=bar", "--custom"],
    })
    expect(buildFingerprintArgs(value)).toEqual([
      "--fingerprint=123456",
      "--fingerprint-brand=Chrome",
      "--fingerprint-brand-version=144.0.7559.132",
      "--fingerprint-platform=macos",
      "--fingerprint-platform-version=10.15.7",
      "--lang=zh-CN",
      "--accept-lang=zh-CN,zh",
      "--timezone=Asia/Shanghai",
      "--window-size=1920,1080",
      "--fingerprint-hardware-concurrency=8",
      "--disable-non-proxied-udp",
      "--fingerprinting-canvas-image-data-noise",
      "--fingerprinting-client-rects-noise=0",
      "--disable-spoofing=font,gpu",
      "--foo=bar",
      "--custom",
    ])
  })

  it("derives accept language, resolves system timezone and maps WebRTC policies", () => {
    const value = fingerprint({
      lang: "en-US",
      acceptLang: "",
      timezone: "system",
      webrtcPolicy: "default_public_interface_only",
    })
    expect(buildFingerprintArgs(value, { screen: { width: 1920, height: 1080 } })).toEqual([
      "--fingerprint=123456",
      "--fingerprint-brand=Chrome",
      "--fingerprint-platform=macos",
      "--lang=en-US",
      "--accept-lang=en-US,en",
      `--timezone=${resolveTimezone("system")}`,
      "--window-size=960,540",
      "--webrtc-ip-handling-policy=default_public_interface_only",
    ])
    expect(
      buildFingerprintArgs(fingerprint({ webrtcPolicy: "default_public_and_private_interfaces" })),
    ).toContain("--webrtc-ip-handling-policy=default_public_and_private_interfaces")
  })

  it("omits empty optional flags but always writes a window size", () => {
    const value = fingerprint({
      lang: "",
      timezone: "",
      resolution: "",
      canvasNoise: "",
      clientRectsNoise: "",
    })
    expect(buildFingerprintArgs(value)).toEqual([
      "--fingerprint=123456",
      "--fingerprint-brand=Chrome",
      "--fingerprint-platform=macos",
      "--window-size=960,540",
    ])
    expect(buildFingerprintArgs(fingerprint({ brand: "", platform: "" }))).toEqual([
      "--fingerprint=123456",
      "--lang=zh-CN",
      "--accept-lang=zh-CN,zh",
      "--timezone=Asia/Shanghai",
      "--window-size=960,540",
    ])
  })

  it("does not emit flags for the nine legacy fields even when they are non-empty", () => {
    const baseline = fingerprint({
      colorDepth: "",
      deviceMemory: "",
      touchPoints: "",
      doNotTrack: "",
      mediaDevices: "",
      audioNoise: "",
      fontList: "",
      webglVendor: "",
      webglRenderer: "",
    })
    const withLegacyValues = fingerprint({
      colorDepth: "24",
      deviceMemory: "8",
      touchPoints: "5",
      doNotTrack: "1",
      mediaDevices: "3",
      audioNoise: "0.7",
      fontList: "Arial, Helvetica",
      webglVendor: "Intel Inc.",
      webglRenderer: "Intel UHD Graphics 630",
    })

    expect(buildFingerprintArgs(withLegacyValues)).toEqual(buildFingerprintArgs(baseline))
  })

  it("maps custom resolution to the custom window size", () => {
    const args = buildFingerprintArgs(
      fingerprint({ resolution: "custom", customResolution: "1280,720" }),
    )
    expect(args).toContain("--window-size=1280,720")
  })

  it("keeps only the accept-lang flag when lang is empty", () => {
    const args = buildFingerprintArgs(fingerprint({ lang: "", acceptLang: "de-DE,de" }))
    expect(args).toContain("--accept-lang=de-DE,de")
    expect(args.some((arg) => arg.startsWith("--lang="))).toBe(false)
  })

  it("maps the three-state noise flags without touching disable-spoofing", () => {
    expect(buildFingerprintArgs(fingerprint({ canvasNoise: "1" }))).toContain(
      "--fingerprinting-canvas-image-data-noise",
    )
    expect(buildFingerprintArgs(fingerprint({ canvasNoise: "0" }))).toContain(
      "--fingerprinting-canvas-image-data-noise=0",
    )
    expect(buildFingerprintArgs(fingerprint({ canvasNoise: "" }))).not.toContain(
      "--fingerprinting-canvas-image-data-noise",
    )
    expect(buildFingerprintArgs(fingerprint({ clientRectsNoise: "1" }))).toContain(
      "--fingerprinting-client-rects-noise",
    )
    expect(buildFingerprintArgs(fingerprint({ clientRectsNoise: "0" }))).toContain(
      "--fingerprinting-client-rects-noise=0",
    )
    expect(buildFingerprintArgs(fingerprint({ clientRectsNoise: "" }))).not.toContain(
      "--fingerprinting-client-rects-noise",
    )
    const disabledNoise = buildFingerprintArgs(fingerprint({ canvasNoise: "0" }))
    expect(disabledNoise.some((arg) => arg.startsWith("--disable-spoofing="))).toBe(false)
  })

  it("emits every disable-spoofing category independently", () => {
    const categories: FingerprintSpoofingCategory[] = [
      "font",
      "audio",
      "canvas",
      "clientrects",
      "gpu",
    ]
    expect(buildFingerprintArgs(fingerprint({ disableSpoofing: categories }))).toContain(
      "--disable-spoofing=font,audio,canvas,clientrects,gpu",
    )
    expect(validateFingerprint(fingerprint({ disableSpoofing: ["gpu", "font", "gpu"] }))).toEqual({
      ok: true,
      fingerprint: expect.objectContaining({ disableSpoofing: ["gpu", "font"] }),
    })
  })

  it("appends unknown args verbatim after all managed flags", () => {
    const unknownArgs = ["--foo", "--bar=1", "  --spaced  "]
    const args = buildFingerprintArgs(fingerprint({ unknownArgs }))
    expect(args.slice(-unknownArgs.length)).toEqual(unknownArgs)
  })

  it("rejects an empty seed that was never generated", () => {
    expect(() => buildFingerprintArgs(fingerprint({ seed: "" }))).toThrow(
      "指纹种子必须在启动前生成",
    )
  })
})

describe("defaultWindowSize", () => {
  it("follows the AntBrowser new-profile rule and falls back to 1920x1080", () => {
    expect(defaultWindowSize()).toBe("960,540")
    expect(defaultWindowSize({ width: 1920, height: 1080 })).toBe("960,540")
    expect(defaultWindowSize({ width: 2560, height: 1440 })).toBe("1075,605")
    expect(defaultWindowSize({ width: 1024, height: 768 })).toBe("960,540")
    expect(defaultWindowSize({ width: 3440, height: 1440 })).toBe("1440,810")
  })
})

describe("validateFingerprint", () => {
  it.each(["0", "2147483648", "9007199254740993", "18446744073709551615"])(
    "保留 PigBrowser 种子 %s 的完整十进制精度",
    (seed) => {
      const result = ensureFingerprint(fingerprint({ seed }), "acc-1")
      expect(result).toMatchObject({ ok: true, fingerprint: { seed } })
      expect(buildFingerprintArgs(fingerprint({ seed }))[0]).toBe(`--fingerprint=${seed}`)
    },
  )

  it("normalizes platform aliases and derives accept language", () => {
    expect(normalizePlatform("macOS")).toBe("macos")
    expect(validateFingerprint(fingerprint({ platform: "mac" }))).toMatchObject({
      ok: true,
      fingerprint: { platform: "macos" },
    })
    expect(validateFingerprint(fingerprint({ seed: "000123" }))).toMatchObject({
      ok: true,
      fingerprint: { seed: "123" },
    })
    expect(acceptLanguage("en-US")).toBe("en-US,en")
    expect(acceptLanguage("zh_Hans_CN")).toBe("zh_Hans_CN,zh")
    expect(acceptLanguage("ja")).toBe("ja")
  })

  it("keeps only whitelisted fields and fills missing optionals", () => {
    const result = validateFingerprint({
      ...fingerprint(),
      futureField: "x",
    } as ClaudeFingerprintView)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fingerprint).not.toHaveProperty("futureField")
      expect(result.fingerprint).toMatchObject({
        brandVersion: "",
        platformVersion: "",
        acceptLang: "",
        resolution: "",
        customResolution: "",
        hardwareConcurrency: "",
        webrtcPolicy: "",
        disableSpoofing: [],
        colorDepth: "",
        deviceMemory: "",
        touchPoints: "",
        doNotTrack: "",
        mediaDevices: "",
        audioNoise: "",
        fontList: "",
        webglVendor: "",
        webglRenderer: "",
        unknownArgs: [],
      })
    }
  })

  it("accepts preset and custom resolutions", () => {
    expect(validateFingerprint(fingerprint({ resolution: "2560,1440" })).ok).toBe(true)
    expect(
      validateFingerprint(fingerprint({ resolution: "custom", customResolution: "1234,777" })).ok,
    ).toBe(true)
    expect(validateFingerprint(fingerprint({ resolution: "" })).ok).toBe(true)
  })

  it("rejects invalid values with a Chinese reason", () => {
    const cases: Array<[string, ClaudeFingerprintView, string]> = [
      ["seed 负数", fingerprint({ seed: "-1" }), "种子"],
      ["seed 非数字", fingerprint({ seed: "abc" }), "种子"],
      ["seed 超范围", fingerprint({ seed: "18446744073709551616" }), "种子"],
      ["brand", fingerprint({ brand: "Safari" }), "品牌"],
      ["brandVersion", fingerprint({ brandVersion: "144.x" }), "品牌版本"],
      ["brandVersion 段数", fingerprint({ brandVersion: "1.2.3.4.5.6" }), "品牌版本"],
      ["platform", fingerprint({ platform: "android" }), "平台"],
      ["platformVersion", fingerprint({ platformVersion: "10.15 beta" }), "系统版本"],
      ["lang", fingerprint({ lang: "中文" }), "语言"],
      ["lang 段过长", fingerprint({ lang: "zh-CN-abcdefghi" }), "语言"],
      ["acceptLang", fingerprint({ acceptLang: "zh-CN,?" }), "Accept-Language"],
      ["timezone", fingerprint({ timezone: "Mars/Olympus" }), "时区"],
      ["resolution 非预设", fingerprint({ resolution: "1234,777" }), "分辨率"],
      ["custom 缺值", fingerprint({ resolution: "custom" }), "分辨率"],
      ["custom 太小", fingerprint({ resolution: "custom", customResolution: "199,200" }), "分辨率"],
      ["hardwareConcurrency 0", fingerprint({ hardwareConcurrency: "0" }), "CPU"],
      ["hardwareConcurrency 129", fingerprint({ hardwareConcurrency: "129" }), "CPU"],
      ["noise", fingerprint({ canvasNoise: "yes" as unknown as FingerprintNoise }), "Canvas"],
      [
        "webrtcPolicy",
        fingerprint({ webrtcPolicy: "unknown" as unknown as FingerprintWebrtcPolicy }),
        "WebRTC",
      ],
      [
        "disableSpoofing",
        fingerprint({
          disableSpoofing: "font" as unknown as FingerprintSpoofingCategory[],
        }),
        "禁用伪装",
      ],
      ["unknownArgs", fingerprint({ unknownArgs: [1] as unknown as string[] }), "原始参数"],
    ]
    for (const [name, value, message] of cases) {
      const result = validateFingerprint(value)
      expect(result.ok, name).toBe(false)
      if (!result.ok) expect(result.message, name).toContain(message)
    }
  })

  it("accepts the legacy seven-field fingerprint with tri-state noise", () => {
    const legacy: ClaudeFingerprintView = {
      seed: "654321",
      brand: "Chrome",
      platform: "macOS",
      lang: "zh-CN",
      timezone: "Asia/Shanghai",
      canvasNoise: "1",
      clientRectsNoise: "1",
    }
    const result = validateFingerprint(legacy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fingerprint).toMatchObject({
        platform: "macos",
        brandVersion: "",
        disableSpoofing: [],
        unknownArgs: [],
      })
    }
    expect(buildFingerprintArgs(legacy)).toEqual([
      "--fingerprint=654321",
      "--fingerprint-brand=Chrome",
      "--fingerprint-platform=macos",
      "--lang=zh-CN",
      "--accept-lang=zh-CN,zh",
      "--timezone=Asia/Shanghai",
      "--window-size=960,540",
      "--fingerprinting-canvas-image-data-noise",
      "--fingerprinting-client-rects-noise",
    ])
  })
})

describe("ensureFingerprint", () => {
  it("derives a stable seed from the account id across restarts", () => {
    const first = ensureFingerprint(fingerprint({ seed: "" }), "acc-1")
    const second = ensureFingerprint(fingerprint({ seed: "" }), "acc-1")
    expect(first).toMatchObject({ ok: true, fingerprint: { seed: "1335753147" } })
    expect(second).toEqual(first)
    expect(ensureFingerprint(fingerprint({ seed: "" }), "acc-2")).toMatchObject({
      ok: true,
      fingerprint: { seed: "660181165" },
    })
  })

  it("keeps a non-empty seed and rejects an out-of-range one", () => {
    expect(ensureFingerprint(fingerprint(), "acc-2")).toMatchObject({
      ok: true,
      fingerprint: { seed: "123456" },
    })
    expect(ensureFingerprint(fingerprint({ seed: "18446744073709551616" }), "acc-1").ok).toBe(false)
  })
})

describe("resolveTimezone", () => {
  it("returns explicit IANA names and resolves system to the host timezone", () => {
    expect(resolveTimezone("Asia/Shanghai")).toBe("Asia/Shanghai")
    expect(resolveTimezone("America/Los_Angeles")).toBe("America/Los_Angeles")
    expect(resolveTimezone(" system ")).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    )
  })
})
