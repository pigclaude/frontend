// 负责提供账号与代理页面使用的可编辑脱敏 fixture。
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { accountFixtures, proxyFixtures } from "./renderer-fixtures"

/** 账号页的状态分类；冷却和停用账号不参与自动切换。 */
export type PoolAccountStatus = "ready" | "disabled" | "reauth" | "cooldown"

/** 账号页面可编辑的脱敏记录。 */
export type PoolAccount = {
  id: string
  name: string
  mark: string
  status: string
  statusKind: PoolAccountStatus
  enabled: boolean
  cooldownUntil: string | null
  usage: number | null
  autoSwitch: boolean
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
  const accounts = accountFixtures.map((account) => ({
    ...account,
    enabled: true,
    statusKind: account.autoSwitch ? ("ready" as const) : ("reauth" as const),
    cooldownUntil: null,
    proxyId:
      account.id === "work"
        ? "sjc-02"
        : account.id === "primary"
          ? "la-01"
          : account.id === "backup"
            ? "sea-03"
            : null,
    fingerprint: account.id === "legacy" ? "fp_93e0…771b" : `fp_${account.id}…73aa`,
  }))
  const proxies = proxyFixtures.map((proxy) => ({ ...proxy, accountId: proxy.accountId ?? null }))
  return { accounts, proxies }
}
