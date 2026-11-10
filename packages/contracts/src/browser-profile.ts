// 定义独立浏览器实例配置的脱敏视图与产品操作，不暴露代理认证或本机浏览器路径。

import { isClaudeFingerprintView, type ClaudeFingerprintView } from "./claude-account"

/** 渲染进程可见的实例；配置版本用于拒绝并发覆盖，绑定状态由主进程计算。 */
export type BrowserProfileView = {
  id: string
  name: string
  proxyId: string | null
  fingerprint: ClaudeFingerprintView
  revision: number
  boundAccounts: Array<{ id: string; name: string }>
  inUse: boolean
  createdAt: string
  updatedAt: string
}

/** 创建或更新实例；修改必须提交读取到的版本，网络参数通过代理 id 引用。 */
export type SaveBrowserProfileInput = {
  id?: string
  revision?: number
  name: string
  proxyId: string | null
  fingerprint: ClaudeFingerprintView
}

/** 同一代理出口的地区初始化建议；语言是地区默认建议，不是 IP 的唯一语言证明。 */
export type BrowserProfileRegion = {
  ip: string
  countryCode: string
  timezone: string
  locale: string
}

/** 设置页使用的公开实例管理接口。 */
export type BrowserProfilesBridge = {
  list: () => Promise<BrowserProfileView[]>
  save: (input: SaveBrowserProfileInput) => Promise<BrowserProfileView>
  remove: (id: string) => Promise<void>
  region: (proxyId: string) => Promise<BrowserProfileRegion>
}

/** 校验脱敏实例视图，旧预览和不完整响应不能伪装成可绑定实例。 */
export function isBrowserProfileView(value: unknown): value is BrowserProfileView {
  if (!record(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.proxyId === null || typeof value.proxyId === "string") &&
    isClaudeFingerprintView(value.fingerprint) &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    Array.isArray(value.boundAccounts) &&
    value.boundAccounts.every(
      (account: unknown) =>
        record(account) && typeof account.id === "string" && typeof account.name === "string",
    ) &&
    typeof value.inUse === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  )
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
