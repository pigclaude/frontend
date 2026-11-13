// 负责维护 8 个 AntBrowser 快速预设和 5 个高级画像；字段值以 AntBrowser 1.8.0 的权威画像表为准。
// 预设不包含种子、原始参数和 9 个旧字段，应用时保留这些用户输入。

import { desktopText } from "../locale/text"
import {
  defaultClaudeFingerprint,
  type ClaudeFingerprintView,
} from "@pigclaude/contracts/claude-account"
import { fingerprintLegacyFields } from "./fingerprint-fields"

/** 预设等级：快速生成和高级画像。 */
export type FingerprintPresetTier = "quick" | "advanced"

/** 一个指纹预设。fingerprint 已补全全部默认值，未列出的字段为空。 */
export type FingerprintPreset = {
  id: string
  name: string
  description: string
  tier: FingerprintPresetTier
  fingerprint: ClaudeFingerprintView
}

/** 8 个 AntBrowser 快速预设；不设置品牌版本、系统版本和禁用伪装类别。 */
export const quickFingerprintPresets: FingerprintPreset[] = [
  createPreset(
    "win-chrome-office",
    desktopText("fingerprint.fingerprint-presets.1"),
    desktopText("fingerprint.fingerprint-presets.2"),
    {
      platform: "windows",
      lang: "zh-CN",
      timezone: "Asia/Shanghai",
      resolution: "1920,1080",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
  ),
  createPreset(
    "win-chrome-gaming",
    desktopText("fingerprint.fingerprint-presets.3"),
    desktopText("fingerprint.fingerprint-presets.4"),
    {
      platform: "windows",
      lang: "en-US",
      timezone: "America/New_York",
      resolution: "2560,1440",
      hardwareConcurrency: "16",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
  ),
  createPreset(
    "mac-chrome-designer",
    desktopText("fingerprint.fingerprint-presets.5"),
    desktopText("fingerprint.fingerprint-presets.6"),
    {
      platform: "macos",
      lang: "zh-CN",
      timezone: "Asia/Shanghai",
      resolution: "2560,1440",
      hardwareConcurrency: "10",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
  ),
  createPreset(
    "win-edge-enterprise",
    desktopText("fingerprint.fingerprint-presets.7"),
    desktopText("fingerprint.fingerprint-presets.8"),
    {
      brand: "Edge",
      platform: "windows",
      lang: "zh-CN",
      timezone: "Asia/Shanghai",
      resolution: "1366,768",
      hardwareConcurrency: "4",
      webrtcPolicy: "default_public_interface_only",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
  ),
  createPreset(
    "win-chrome-us-user",
    desktopText("fingerprint.fingerprint-presets.9"),
    desktopText("fingerprint.fingerprint-presets.10"),
    {
      platform: "windows",
      lang: "en-US",
      timezone: "America/Los_Angeles",
      resolution: "1920,1080",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
  ),
  createPreset(
    "mac-chrome-jp",
    desktopText("fingerprint.fingerprint-presets.11"),
    desktopText("fingerprint.fingerprint-presets.12"),
    {
      platform: "macos",
      lang: "ja-JP",
      timezone: "Asia/Tokyo",
      resolution: "1440,900",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
  ),
  createPreset(
    "win-chrome-uk-office",
    desktopText("fingerprint.fingerprint-presets.13"),
    desktopText("fingerprint.fingerprint-presets.14"),
    {
      platform: "windows",
      lang: "en-GB",
      timezone: "Europe/London",
      resolution: "1920,1080",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
  ),
  createPreset(
    "mac-chrome-us-edu",
    desktopText("fingerprint.fingerprint-presets.15"),
    desktopText("fingerprint.fingerprint-presets.16"),
    {
      platform: "macos",
      lang: "en-US",
      timezone: "America/New_York",
      resolution: "1440,900",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
  ),
]

/** 5 个高级画像；全部开启噪声并禁用非代理 UDP，不设置禁用伪装类别。 */
export const advancedFingerprintProfiles: FingerprintPreset[] = [
  createPreset(
    "us-win-chrome-office",
    desktopText("fingerprint.fingerprint-presets.17"),
    desktopText("fingerprint.fingerprint-presets.18"),
    {
      platform: "windows",
      platformVersion: "10.0.0",
      lang: "en-US",
      timezone: "America/New_York",
      resolution: "1920,1080",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    "advanced",
  ),
  createPreset(
    "jp-mac-chrome-light",
    desktopText("fingerprint.fingerprint-presets.19"),
    desktopText("fingerprint.fingerprint-presets.20"),
    {
      platform: "macos",
      platformVersion: "15.2.0",
      lang: "ja-JP",
      timezone: "Asia/Tokyo",
      resolution: "1440,900",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    "advanced",
  ),
  createPreset(
    "uk-win-edge-enterprise",
    desktopText("fingerprint.fingerprint-presets.21"),
    desktopText("fingerprint.fingerprint-presets.22"),
    {
      brand: "Edge",
      platform: "windows",
      platformVersion: "10.0.0",
      lang: "en-GB",
      timezone: "Europe/London",
      resolution: "1920,1080",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    "advanced",
  ),
  createPreset(
    "sg-win-chrome-business",
    desktopText("fingerprint.fingerprint-presets.23"),
    desktopText("fingerprint.fingerprint-presets.24"),
    {
      platform: "windows",
      platformVersion: "10.0.0",
      lang: "en-SG",
      timezone: "Asia/Singapore",
      resolution: "1920,1080",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    "advanced",
  ),
  createPreset(
    "de-linux-chrome-dev",
    desktopText("fingerprint.fingerprint-presets.25"),
    desktopText("fingerprint.fingerprint-presets.26"),
    {
      platform: "linux",
      lang: "de-DE",
      timezone: "Europe/Berlin",
      resolution: "1920,1080",
      hardwareConcurrency: "12",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    "advanced",
  ),
]

function createPreset(
  id: string,
  name: string,
  description: string,
  overrides: Partial<ClaudeFingerprintView>,
  tier: FingerprintPresetTier = "quick",
): FingerprintPreset {
  return {
    id,
    name,
    description,
    tier,
    fingerprint: { ...defaultClaudeFingerprint(), ...overrides },
  }
}

/**
 * 应用预设：覆盖画像字段，但保留种子、原始参数和 9 个旧字段。
 * 保证不会静默清空用户在高级参数或旧记录里保存的内容。
 */
export function applyFingerprintPreset(
  current: ClaudeFingerprintView,
  preset: FingerprintPreset,
): ClaudeFingerprintView {
  const next: ClaudeFingerprintView = { ...preset.fingerprint, seed: current.seed }
  if (current.unknownArgs === undefined) delete next.unknownArgs
  else next.unknownArgs = current.unknownArgs
  for (const field of fingerprintLegacyFields) {
    const value = current[field.key]
    if (value === undefined) delete next[field.key]
    else next[field.key] = value
  }
  return next
}
