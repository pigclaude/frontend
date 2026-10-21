// 负责把账号指纹配置转换成 fingerprint-chromium 的启动参数，并验证用户可设置的取值。

import { randomInt } from "node:crypto"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"

const brands = new Set(["Chrome", "Edge", "Opera", "Vivaldi"])
const platforms = new Set(["windows", "linux", "macos"])
const langPattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/** 指纹校验结果。失败时带中文原因，成功时返回归一化后的配置。 */
export type FingerprintValidation =
  { ok: true; fingerprint: ClaudeFingerprintView } | { ok: false; message: string }

/** 校验并归一化指纹。保证平台别名被统一，种子在内核支持的整数范围内。 */
export function validateFingerprint(value: ClaudeFingerprintView): FingerprintValidation {
  const seed = value.seed.trim()
  const seedNumber = Number(seed)
  if (
    !/^\d+$/.test(seed) ||
    !Number.isInteger(seedNumber) ||
    seedNumber < 1 ||
    seedNumber > 2_147_483_647
  ) {
    return { ok: false, message: "指纹种子必须是 1 到 2147483647 的整数" }
  }
  if (!brands.has(value.brand)) {
    return { ok: false, message: "浏览器品牌仅支持 Chrome、Edge、Opera、Vivaldi" }
  }
  const platform = normalizePlatform(value.platform)
  if (!platforms.has(platform)) {
    return { ok: false, message: "平台仅支持 windows、linux、macos" }
  }
  if (!langPattern.test(value.lang)) {
    return { ok: false, message: "语言格式不正确，例如 zh-CN 或 en-US" }
  }
  if (!isTimeZone(value.timezone)) {
    return { ok: false, message: "时区不是当前系统可识别的 IANA 名称" }
  }
  if (typeof value.canvasNoise !== "boolean" || typeof value.clientRectsNoise !== "boolean") {
    return { ok: false, message: "噪声开关必须是布尔值" }
  }
  return {
    ok: true,
    fingerprint: {
      ...value,
      seed,
      platform,
      lang: value.lang.trim(),
      timezone: value.timezone.trim(),
    },
  }
}

/** 保证空种子生成一次随机整数，再交给 validateFingerprint 校验。 */
export function ensureFingerprint(value: ClaudeFingerprintView): FingerprintValidation {
  const seed = value.seed.trim() === "" ? String(randomInt(1, 2_147_483_648)) : value.seed
  return validateFingerprint({ ...value, seed })
}

/** 生成 fingerprint-chromium 的指纹参数。保证调用前已经通过校验。 */
export function buildFingerprintArgs(value: ClaudeFingerprintView): string[] {
  const validation = validateFingerprint(value)
  if (!validation.ok) throw new Error(validation.message)
  const fingerprint = validation.fingerprint
  return [
    `--fingerprint=${fingerprint.seed}`,
    `--fingerprint-brand=${fingerprint.brand}`,
    `--fingerprint-platform=${fingerprint.platform}`,
    `--lang=${fingerprint.lang}`,
    `--accept-lang=${acceptLanguage(fingerprint.lang)}`,
    `--timezone=${fingerprint.timezone}`,
    ...disableSpoofingArgs(fingerprint),
  ]
}

/** 把关闭的噪声项映射为 Chrome 144+ 的 --disable-spoofing。开启时由种子驱动，不加参数。 */
export function disableSpoofingArgs(value: ClaudeFingerprintView): string[] {
  const disabled: string[] = []
  if (!value.canvasNoise) disabled.push("canvas")
  if (!value.clientRectsNoise) disabled.push("clientrects")
  return disabled.length === 0 ? [] : [`--disable-spoofing=${disabled.join(",")}`]
}

/** 由语言推导 Accept-Language。zh-CN 变成 zh-CN,zh。 */
export function acceptLanguage(lang: string): string {
  const trimmed = lang.trim()
  const separator = trimmed.indexOf("-")
  return separator > 0 ? `${trimmed},${trimmed.slice(0, separator)}` : trimmed
}

/** 把 mac/macOS/darwin 归一为 macos，其余平台转小写。 */
export function normalizePlatform(platform: string): string {
  const normalized = platform.trim().toLowerCase()
  if (normalized === "mac" || normalized === "macos" || normalized === "darwin") return "macos"
  if (normalized === "win" || normalized === "windows") return "windows"
  return normalized
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}
