// 负责维护 8 个 AntBrowser 快速预设和 5 个高级画像；字段值以 AntBrowser 1.8.0 的权威画像表为准。
// 预设不包含种子、原始参数和 9 个旧字段，应用时保留这些用户输入。

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
  createPreset("win-chrome-office", "Windows · Chrome 办公", "中文办公环境 · 1080p · 8 核", {
    platform: "windows",
    lang: "zh-CN",
    timezone: "Asia/Shanghai",
    resolution: "1920,1080",
    hardwareConcurrency: "8",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset("win-chrome-gaming", "Windows · Chrome 游戏", "美东高配桌面 · 1440p · 16 核", {
    platform: "windows",
    lang: "en-US",
    timezone: "America/New_York",
    resolution: "2560,1440",
    hardwareConcurrency: "16",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset("mac-chrome-designer", "macOS · Chrome 设计", "中文设计环境 · 1440p · 10 核", {
    platform: "macos",
    lang: "zh-CN",
    timezone: "Asia/Shanghai",
    resolution: "2560,1440",
    hardwareConcurrency: "10",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset(
    "win-edge-enterprise",
    "Windows · Edge 企业",
    "Edge + 企业网络策略 · 1366x768 · 4 核",
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
  createPreset("win-chrome-us-user", "Windows · Chrome 美国用户", "美国普通用户 · 1080p · 8 核", {
    platform: "windows",
    lang: "en-US",
    timezone: "America/Los_Angeles",
    resolution: "1920,1080",
    hardwareConcurrency: "8",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset("mac-chrome-jp", "macOS · Chrome 日本", "东京时区 · 日文 · 1440x900 · 8 核", {
    platform: "macos",
    lang: "ja-JP",
    timezone: "Asia/Tokyo",
    resolution: "1440,900",
    hardwareConcurrency: "8",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset(
    "win-chrome-uk-office",
    "Windows · Chrome 英国办公",
    "伦敦时区 · 英文 · 1080p · 8 核",
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
  createPreset("mac-chrome-us-edu", "macOS · Chrome 美国校园", "美国校园环境 · 1440x900 · 8 核", {
    platform: "macos",
    lang: "en-US",
    timezone: "America/New_York",
    resolution: "1440,900",
    hardwareConcurrency: "8",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
]

/** 5 个高级画像；全部开启噪声并禁用非代理 UDP，不设置禁用伪装类别。 */
export const advancedFingerprintProfiles: FingerprintPreset[] = [
  createPreset(
    "us-win-chrome-office",
    "美国 · Windows 办公画像",
    "Windows 10 · 美东办公 · 1080p · 8 核",
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
    "日本 · macOS 轻量画像",
    "macOS 15.2 · 东京 · 1440x900 · 8 核",
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
    "英国 · Edge 企业画像",
    "Edge · Windows 10 · 伦敦 · 1080p · 8 核",
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
    "新加坡 · Chrome 商务画像",
    "Windows 10 · 新加坡 · 1080p · 8 核",
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
    "德国 · Linux 开发画像",
    "Linux · 柏林 · 1080p · 12 核",
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
  const next: ClaudeFingerprintView = {
    ...preset.fingerprint,
    seed: current.seed,
    unknownArgs: current.unknownArgs,
  }
  for (const field of fingerprintLegacyFields) next[field.key] = current[field.key]
  return next
}
