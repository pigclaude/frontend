// 指纹参数测试。覆盖种子/品牌/平台/语言/时区映射、噪声关闭和取值校验。

import { describe, expect, it } from "vitest"
import {
  acceptLanguage,
  buildFingerprintArgs,
  disableSpoofingArgs,
  ensureFingerprint,
  validateFingerprint,
} from "./fingerprint-args"

const fingerprint = {
  seed: "123456",
  brand: "Chrome",
  platform: "macOS",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",
  canvasNoise: true,
  clientRectsNoise: true,
}

describe("fingerprint args", () => {
  it("maps the managed fields to fingerprint-chromium flags", () => {
    expect(buildFingerprintArgs(fingerprint)).toEqual([
      "--fingerprint=123456",
      "--fingerprint-brand=Chrome",
      "--fingerprint-platform=macos",
      "--lang=zh-CN",
      "--accept-lang=zh-CN,zh",
      "--timezone=Asia/Shanghai",
    ])
  })

  it("disables only the noise sources the user turned off", () => {
    expect(disableSpoofingArgs(fingerprint)).toEqual([])
    expect(disableSpoofingArgs({ ...fingerprint, canvasNoise: false })).toEqual([
      "--disable-spoofing=canvas",
    ])
    expect(
      disableSpoofingArgs({ ...fingerprint, canvasNoise: false, clientRectsNoise: false }),
    ).toEqual(["--disable-spoofing=canvas,clientrects"])
    expect(buildFingerprintArgs({ ...fingerprint, clientRectsNoise: false })).toContain(
      "--disable-spoofing=clientrects",
    )
  })

  it("normalizes platform aliases and derives accept-language", () => {
    expect(validateFingerprint({ ...fingerprint, platform: "mac" }).ok).toBe(true)
    expect(acceptLanguage("en-US")).toBe("en-US,en")
    expect(acceptLanguage("ja")).toBe("ja")
  })

  it("generates a seed only when it is empty", () => {
    const generated = ensureFingerprint({ ...fingerprint, seed: "" })
    expect(generated.ok).toBe(true)
    if (generated.ok) {
      const seed = Number(generated.fingerprint.seed)
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(1)
      expect(seed).toBeLessThanOrEqual(2_147_483_647)
    }
    expect(ensureFingerprint(fingerprint)).toMatchObject({
      ok: true,
      fingerprint: { seed: "123456" },
    })
  })

  it("rejects invalid seeds, brands, platforms, languages and timezones", () => {
    expect(validateFingerprint({ ...fingerprint, seed: "0" }).ok).toBe(false)
    expect(validateFingerprint({ ...fingerprint, seed: "abc" }).ok).toBe(false)
    expect(validateFingerprint({ ...fingerprint, brand: "Safari" }).ok).toBe(false)
    expect(validateFingerprint({ ...fingerprint, platform: "android" }).ok).toBe(false)
    expect(validateFingerprint({ ...fingerprint, lang: "中文" }).ok).toBe(false)
    expect(validateFingerprint({ ...fingerprint, timezone: "Mars/Olympus" }).ok).toBe(false)
  })
})
