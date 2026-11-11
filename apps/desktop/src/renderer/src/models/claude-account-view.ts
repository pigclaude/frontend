// 负责把脱敏账号和代理视图映射成现有页面使用的展示记录。

import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import type { PoolAccount, PoolAccountStatus, PoolProxy } from "../fixtures/pool-fixtures"

/** 把账号视图映射成账号页记录。保证不引入 token 或代理密码。 */
export function toPoolAccount(view: ClaudeAccountView, proxies: ProxyView[]): PoolAccount {
  const proxy = proxies.find((item) => item.id === view.proxyId) ?? null
  const statusKind = accountStatusKind(view)
  return {
    id: view.id,
    ...(view.browserProfileId ? { browserProfileId: view.browserProfileId } : {}),
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

/** 账号网络出口的展示文案。保证 direct 账号明确显示使用系统网络，而不是「未绑定代理」。 */
export function accountNetworkLabel(account: PoolAccount): string {
  if (account.proxyId === null) return "系统网络（直连）"
  return account.proxyName ?? "代理不可用"
}

/** 代理还没有测试结果时 exit / region 使用的占位文字。 */
const untestedLabel = "待检测"

/** 把代理视图映射成代理页记录。保证失败结果不被显示成可用。 */
export function toPoolProxy(view: ProxyView, accounts: ClaudeAccountView[]): PoolProxy {
  return {
    id: view.id,
    name: view.name,
    exit: view.lastTest?.ip ?? untestedLabel,
    region: view.lastTest?.testedAt ? "已测试" : untestedLabel,
    latency: view.lastTest?.latencyMs ?? 0,
    accountId: accounts.find((account) => account.proxyId === view.id)?.id ?? null,
    available: view.lastTest?.ok ?? false,
  }
}

/** 代理是否从未测试过。只认 toPoolProxy 写入的占位，不另起一套判断。 */
function isUntested(proxy: PoolProxy): boolean {
  return proxy.region === untestedLabel
}

/** 代理行的说明文字：未测试只说一次「尚未测试出口」，测过但没拿到出口 IP 时如实说明。 */
export function proxyDescription(proxy: PoolProxy): string {
  if (isUntested(proxy)) return "尚未测试出口"
  if (proxy.exit === untestedLabel) return `未取得出口 IP · ${proxy.region}`
  return `${proxy.exit} · ${proxy.region}`
}

/** 代理状态分三种：可用、尚未测试、测试未通过。未测试不显示成失败，也不显示成可用。 */
export function proxyStatus(proxy: PoolProxy): { tone: "ok" | "idle" | "bad"; label: string } {
  if (proxy.available) return { tone: "ok", label: `${proxy.latency} ms` }
  if (isUntested(proxy)) return { tone: "idle", label: "待检测" }
  return { tone: "bad", label: "未通过测试" }
}

/** 状态圆点的类名：可用为绿、测试失败为红，未测试保持中性。 */
export function proxyStatusClass(proxy: PoolProxy): string {
  const { tone } = proxyStatus(proxy)
  return tone === "idle" ? "status" : `status ${tone}`
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
