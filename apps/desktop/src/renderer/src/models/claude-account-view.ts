// 负责把脱敏账号和代理视图映射成现有页面使用的展示记录。

import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import type { PoolAccount, PoolAccountStatus, PoolProxy } from "../fixtures/pool-fixtures"

/** 把账号视图映射成账号页记录。保证不引入 token 或代理密码。 */
export function toPoolAccount(view: ClaudeAccountView, proxies: ProxyView[]): PoolAccount {
  const proxy = proxies.find((item) => item.id === view.proxyId) ?? null
  const statusKind = accountStatusKind(view)
  return {
    id: view.id,
    name: view.displayName,
    mark: view.displayName.slice(0, 1) || "?",
    status: accountStatus(view, statusKind),
    statusKind,
    enabled: view.enabled,
    cooldownUntil: view.exhaustedUntil ?? null,
    usage: null,
    autoSwitch: statusKind === "ready",
    proxyId: view.proxyId,
    fingerprint: view.fingerprint.seed,
    email: view.email,
    subscriptionType: view.subscriptionType,
    needsReauth: view.needsReauth,
    credentialExpiresAt: view.credentialExpiresAt,
    proxyName: proxy?.name ?? null,
    proxyExit: proxy?.lastTest?.ip ?? null,
    fingerprintDetail: view.fingerprint,
  }
}

/** 把代理视图映射成代理页记录。保证失败结果不被显示成可用。 */
export function toPoolProxy(view: ProxyView, accounts: ClaudeAccountView[]): PoolProxy {
  return {
    id: view.id,
    name: view.name,
    exit: view.lastTest?.ip ?? "待检测",
    region: view.lastTest?.testedAt ? "已测试" : "待检测",
    latency: view.lastTest?.latencyMs ?? 0,
    accountId: accounts.find((account) => account.proxyId === view.id)?.id ?? null,
    available: view.lastTest?.ok ?? false,
  }
}

function accountStatusKind(view: ClaudeAccountView): PoolAccountStatus {
  if (view.needsReauth) return "reauth"
  if (!view.enabled) return "disabled"
  if (isCoolingDown(view.exhaustedUntil)) return "cooldown"
  return "ready"
}

function accountStatus(view: ClaudeAccountView, kind: PoolAccountStatus): string {
  if (kind === "reauth") return "需要重新授权"
  if (kind === "disabled") return "已停用"
  if (kind === "cooldown") return `冷却中 · ${coolingTime(view.exhaustedUntil)} 后恢复`
  return view.subscriptionType === null ? "已授权" : `已授权 · ${view.subscriptionType}`
}

function isCoolingDown(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const until = Date.parse(value)
  return Number.isFinite(until) && until > Date.now()
}

function coolingTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return "稍后"
  const until = Date.parse(value)
  if (!Number.isFinite(until)) return "稍后"
  return new Date(until).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}
