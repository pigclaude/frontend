// 负责把脱敏账号和代理视图映射成现有页面使用的展示记录。

import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import type { PoolAccount, PoolProxy } from "../fixtures/pool-fixtures"

/** 把账号视图映射成账号页记录。保证不引入 token 或代理密码。 */
export function toPoolAccount(view: ClaudeAccountView, proxies: ProxyView[]): PoolAccount {
  const proxy = proxies.find((item) => item.id === view.proxyId) ?? null
  return {
    id: view.id,
    name: view.displayName,
    mark: view.displayName.slice(0, 1) || "?",
    status: accountStatus(view),
    usage: null,
    autoSwitch: view.enabled && !view.needsReauth,
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

function accountStatus(view: ClaudeAccountView): string {
  if (view.needsReauth) return "需要重新授权"
  if (!view.enabled) return "已停用"
  if (view.credentialExpiresAt !== null && view.credentialExpiresAt <= Date.now()) {
    return "凭据待刷新"
  }
  return view.subscriptionType === null ? "已授权" : `已授权 · ${view.subscriptionType}`
}
