// 负责提供账号与代理页面使用的可编辑脱敏 fixture。
import {
  defaultClaudeFingerprint,
  type ClaudeFingerprintView,
} from "@pigclaude/contracts/claude-account"
import { accountFixtures, proxyFixtures } from "./renderer-fixtures"

/** 账号页的状态分类；冷却和停用账号不参与自动切换。 */
export type PoolAccountStatus = "ready" | "disabled" | "reauth" | "cooldown"

/** 账号页面可编辑的脱敏记录。 */
export type PoolAccount = {
  id: string
  browserProfileId?: string
  name: string
  mark: string
  status: string
  statusKind: PoolAccountStatus
  enabled: boolean
  cooldownUntil: string | null
  usage: number | null
  autoSwitch: boolean
  /** 绑定的代理 id；null 表示不绑定代理、使用系统网络。 */
  proxyId: string | null
  fingerprint: string
  email?: string | null
  subscriptionType?: string | null
  needsReauth?: boolean
  credentialExpiresAt?: number | null
  proxyName?: string | null
  proxyExit?: string | null
  fingerprintDetail?: ClaudeFingerprintView
}

/** 代理页面可编辑的脱敏记录。 */
export type PoolProxy = {
  id: string
  name: string
  exit: string
  region: string
  latency: number
  accountId: string | null
  available: boolean
}

/** 创建账号和代理页面的初始 fixture。 */
export function createPoolFixtures(): { accounts: PoolAccount[]; proxies: PoolProxy[] } {
  const accounts = accountFixtures.map((account, index) => {
    const fingerprint = previewFingerprint(account.id, index)
    return {
      ...account,
      enabled: true,
      statusKind: account.autoSwitch ? ("ready" as const) : ("reauth" as const),
      cooldownUntil: null,
      // 备用 Pro 演示 direct 账号，其余账号各绑定一个代理。
      proxyId: account.id === "work" ? "sjc-02" : account.id === "primary" ? "la-01" : null,
      fingerprint: fingerprint.seed,
      fingerprintDetail: fingerprint,
    }
  })
  const proxies = proxyFixtures.map((proxy) => ({ ...proxy, accountId: proxy.accountId ?? null }))
  return { accounts, proxies }
}

/** 演示账号的完整指纹；旧号用 Windows + 日文，其余用 macOS + 英文。 */
function previewFingerprint(accountId: string, index: number): ClaudeFingerprintView {
  const legacy = accountId === "legacy"
  return {
    ...defaultClaudeFingerprint(),
    seed: ["937461", "184203", "520117", "331908"][index] ?? "",
    brand: legacy ? "Edge" : "Chrome",
    brandVersion: "144.0.7559.132",
    platform: legacy ? "windows" : "macos",
    platformVersion: legacy ? "10.0.0" : "15.0.0",
    lang: legacy ? "ja-JP" : "en-US",
    acceptLang: legacy ? "ja-JP,ja" : "en-US,en",
    timezone: legacy ? "Asia/Tokyo" : "America/Los_Angeles",
    resolution: legacy ? "1920,1080" : "1440,900",
    hardwareConcurrency: legacy ? "8" : "10",
    canvasNoise: "1",
    clientRectsNoise: "1",
    disableSpoofing: legacy ? ["font"] : [],
  }
}
