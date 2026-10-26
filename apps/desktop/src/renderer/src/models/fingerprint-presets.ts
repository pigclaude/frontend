// 负责维护 8 个 AntBrowser 快速预设和 5 个高级画像；字段值以 AntBrowser 1.8.0 的画像组合为基线。
// 预设不包含种子，应用时保留用户当前种子，避免编辑已有账号时换掉指纹身份。

import {
  defaultClaudeFingerprint,
  type ClaudeFingerprintView,
} from "@pigclaude/contracts/claude-account"

/** 预设等级：快速生成和高级画像。 */
export type FingerprintPresetTier = "quick" | "advanced"

/** 一个指纹预设。fingerprint 已补全全部默认值。 */
export type FingerprintPreset = {
  id: string
  name: string
  description: string
  tier: FingerprintPresetTier
  fingerprint: ClaudeFingerprintView
}

/** 8 个 AntBrowser 快速预设。 */
export const quickFingerprintPresets: FingerprintPreset[] = [
  createPreset("win-chrome-office", "Windows · Chrome 办公", "美东办公环境 · 1080p · 8 核", {
    platform: "windows",
    platformVersion: "10.0.0",
    brandVersion: "144.0.7559.132",
    lang: "en-US",
    acceptLang: "en-US,en",
    timezone: "America/New_York",
    resolution: "1920,1080",
    hardwareConcurrency: "8",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset("win-chrome-gaming", "Windows · Chrome 游戏", "高配桌面 · 1440p · 16 核", {
    platform: "windows",
    platformVersion: "10.0.0",
    brandVersion: "144.0.7559.132",
    lang: "en-US",
    acceptLang: "en-US,en",
    timezone: "America/Los_Angeles",
    resolution: "2560,1440",
    hardwareConcurrency: "16",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset("mac-chrome-designer", "macOS · Chrome 设计", "macOS 15 · 1440x900 · 10 核", {
    platform: "macos",
    platformVersion: "15.0.0",
    brandVersion: "144.0.7559.132",
    lang: "en-US",
    acceptLang: "en-US,en",
    timezone: "America/Los_Angeles",
    resolution: "1440,900",
    hardwareConcurrency: "10",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset("win-edge-enterprise", "Windows · Edge 企业", "Edge + 企业策略 · 字体不伪装", {
    brand: "Edge",
    platform: "windows",
    platformVersion: "10.0.0",
    brandVersion: "144.0.7559.132",
    lang: "en-US",
    acceptLang: "en-US,en",
    timezone: "America/New_York",
    resolution: "1920,1080",
    hardwareConcurrency: "8",
    webrtcPolicy: "default_public_interface_only",
    canvasNoise: "1",
    clientRectsNoise: "1",
    disableSpoofing: ["font"],
  }),
  createPreset("win-chrome-us-user", "Windows · Chrome 美国用户", "美国普通用户 · 1080p · 8 核", {
    platform: "windows",
    platformVersion: "10.0.0",
    brandVersion: "144.0.7559.132",
    lang: "en-US",
    acceptLang: "en-US,en",
    timezone: "America/Chicago",
    resolution: "1920,1080",
    hardwareConcurrency: "8",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset("mac-chrome-jp", "macOS · Chrome 日本", "东京时区 · 日文 · 1440x900", {
    platform: "macos",
    platformVersion: "15.0.0",
    brandVersion: "144.0.7559.132",
    lang: "ja-JP",
    acceptLang: "ja-JP,ja",
    timezone: "Asia/Tokyo",
    resolution: "1440,900",
    hardwareConcurrency: "8",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset("win-chrome-uk-office", "Windows · Chrome 英国办公", "伦敦时区 · 英文 · 1600x900", {
    platform: "windows",
    platformVersion: "10.0.0",
    brandVersion: "144.0.7559.132",
    lang: "en-GB",
    acceptLang: "en-GB,en",
    timezone: "Europe/London",
    resolution: "1600,900",
    hardwareConcurrency: "8",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
  createPreset("mac-chrome-us-edu", "macOS · Chrome 美国校园", "校园设备 · 1366x768 · 4 核", {
    platform: "macos",
    platformVersion: "15.0.0",
    brandVersion: "144.0.7559.132",
    lang: "en-US",
    acceptLang: "en-US,en",
    timezone: "America/New_York",
    resolution: "1366,768",
    hardwareConcurrency: "4",
    webrtcPolicy: "disable_non_proxied_udp",
    canvasNoise: "1",
    clientRectsNoise: "1",
  }),
]

/** 5 个高级画像，覆盖企业、轻量和 Linux 等组合。 */
export const advancedFingerprintProfiles: FingerprintPreset[] = [
  createPreset(
    "us-win-chrome-office",
    "美国 · Windows 办公画像",
    "禁用字体与音频伪装，保留 Canvas 噪声",
    {
      platform: "windows",
      platformVersion: "10.0.0",
      brandVersion: "144.0.7559.132",
      lang: "en-US",
      acceptLang: "en-US,en",
      timezone: "America/New_York",
      resolution: "1920,1080",
      hardwareConcurrency: "8",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "1",
      disableSpoofing: ["font", "audio"],
    },
    "advanced",
  ),
  createPreset(
    "jp-mac-chrome-light",
    "日本 · macOS 轻量画像",
    "低配 4 核，关闭 ClientRects 噪声",
    {
      platform: "macos",
      platformVersion: "15.0.0",
      brandVersion: "144.0.7559.132",
      lang: "ja-JP",
      acceptLang: "ja-JP,ja",
      timezone: "Asia/Tokyo",
      resolution: "1280,800",
      hardwareConcurrency: "4",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "1",
      clientRectsNoise: "0",
    },
    "advanced",
  ),
  createPreset(
    "uk-win-edge-enterprise",
    "英国 · Edge 企业画像",
    "Edge + 伦敦时区 + 仅公网 WebRTC",
    {
      brand: "Edge",
      platform: "windows",
      platformVersion: "10.0.0",
      brandVersion: "144.0.7559.132",
      lang: "en-GB",
      acceptLang: "en-GB,en",
      timezone: "Europe/London",
      resolution: "1920,1080",
      hardwareConcurrency: "8",
      webrtcPolicy: "default_public_interface_only",
      canvasNoise: "1",
      clientRectsNoise: "1",
      disableSpoofing: ["font"],
    },
    "advanced",
  ),
  createPreset(
    "sg-win-chrome-business",
    "新加坡 · Chrome 商务画像",
    "新加坡时区 · 1080p · 8 核",
    {
      platform: "windows",
      platformVersion: "10.0.0",
      brandVersion: "144.0.7559.132",
      lang: "en-SG",
      acceptLang: "en-SG,en",
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
    "Linux 6.8 · 德文 · 关闭 Canvas 噪声",
    {
      platform: "linux",
      platformVersion: "6.8.0",
      brandVersion: "144.0.7559.132",
      lang: "de-DE",
      acceptLang: "de-DE,de",
      timezone: "Europe/Berlin",
      resolution: "1920,1080",
      hardwareConcurrency: "16",
      webrtcPolicy: "disable_non_proxied_udp",
      canvasNoise: "0",
      clientRectsNoise: "1",
      disableSpoofing: ["font", "audio"],
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

/** 按 id 查找预设；找不到返回 null。 */
export function fingerprintPreset(id: string): FingerprintPreset | null {
  return (
    [...quickFingerprintPresets, ...advancedFingerprintProfiles].find(
      (preset) => preset.id === id,
    ) ?? null
  )
}

/** 应用预设：覆盖画像字段但保留当前种子，避免编辑账号时意外换掉指纹身份。 */
export function applyFingerprintPreset(
  current: ClaudeFingerprintView,
  preset: FingerprintPreset,
): ClaudeFingerprintView {
  return { ...preset.fingerprint, seed: current.seed }
}
