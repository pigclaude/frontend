// 将实例配置解析成一次授权的环境快照，共享配置但始终隔离账号浏览器数据。

import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import type { LocalStore, IpProxy } from "@pigclaude/local-store"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { AuthorizeClaudeAccountInput } from "./account-service-inputs"
import { ClaudeAccountError } from "./errors"
import { ensureFingerprint } from "./fingerprint-args"
import { BrowserProfileUsage } from "./browser-profile-usage"
import { systemLocale, systemTimezone } from "../session/session-locale"

/** 同一实例版本和代理材料的授权快照；不包含任何可由 renderer 选择的数据目录。 */
export type AccountBrowserProfile = {
  browserProfileId: string
  revision: number
  browserDataId: string
  proxyId: string | null
  proxy: IpProxy | null
  fingerprint: ClaudeFingerprintView
  release: () => void
  assertCurrent: () => Promise<void>
}

/** 兼容旧主进程调用时先生成独立配置；产品 IPC 只接受实例引用，后续全部读同一快照。 */
export async function accountBrowserProfile(
  store: LocalStore,
  input: AuthorizeClaudeAccountInput,
  accountId: string,
  options: {
    usage?: BrowserProfileUsage
    systemLocale?: () => string
    systemTimezone?: () => string
  } = {},
): Promise<AccountBrowserProfile> {
  let profileId = input.browserProfileId
  const existing = await store.getAccount(accountId)
  if (!profileId) {
    profileId = existing?.browserProfileId ?? accountId
    if (!(await store.getBrowserProfile(profileId))) {
      const raw = input.fingerprint
      if (!raw) throw new ClaudeAccountError("FINGERPRINT_INVALID", "浏览器实例标识不能为空")
      const validation = ensureFingerprint(raw, profileId)
      if (!validation.ok) throw new ClaudeAccountError("FINGERPRINT_INVALID", validation.message)
      const timestamp = new Date().toISOString()
      await store.saveBrowserProfile({
        schemaVersion: 1,
        id: profileId,
        name: `${input.displayName} 的浏览器`,
        fingerprint: {
          ...validation.fingerprint,
          lang: validation.fingerprint.lang || (options.systemLocale ?? systemLocale)(),
          timezone:
            !validation.fingerprint.timezone || validation.fingerprint.timezone === "system"
              ? (options.systemTimezone ?? systemTimezone)()
              : validation.fingerprint.timezone,
        },
        proxyId: input.proxyId ?? null,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        legacyAccountId: accountId,
      })
    }
  }
  if (existing?.browserProfileId && input.accountId && existing.browserProfileId !== profileId)
    throw new ClaudeAccountError("INVALID_INPUT", "请先在账号设置中更换浏览器配置")
  const release = options.usage?.acquire(profileId, randomUUID(), accountId) ?? (() => undefined)
  try {
    const baseline = await store.getAccount(accountId)
    if (input.accountId && (!baseline || baseline.browserProfileId !== profileId))
      throw new ClaudeAccountError("INVALID_INPUT", "账号关联配置已变化，请重新选择并检测")
    const profile = await store.getBrowserProfile(profileId)
    if (!profile) throw new ClaudeAccountError("FINGERPRINT_INVALID", "浏览器实例配置不存在")
    const proxy = profile.proxyId === null ? null : await store.getProxy(profile.proxyId)
    if (profile.proxyId !== null && !proxy)
      throw new ClaudeAccountError("PROXY_INVALID", "实例绑定的代理不存在")
    return {
      browserProfileId: profile.id,
      revision: profile.revision,
      browserDataId: accountId,
      proxyId: profile.proxyId,
      proxy,
      fingerprint: structuredClone(profile.fingerprint),
      release,
      assertCurrent: async () => {
        const latest = await store.getBrowserProfile(profile.id)
        const currentProxy = profile.proxyId === null ? null : await store.getProxy(profile.proxyId)
        const currentAccount = await store.getAccount(accountId)
        if (
          !isDeepStrictEqual(latest, profile) ||
          currentProxy?.url !== proxy?.url ||
          currentAccount?.browserProfileId !== baseline?.browserProfileId ||
          !!currentAccount !== !!baseline
        )
          throw new ClaudeAccountError(
            "ENVIRONMENT_CHECK_FAILED",
            "浏览器配置或代理已变化，请重新检测",
          )
      },
    }
  } catch (error: unknown) {
    release()
    throw error
  }
}
