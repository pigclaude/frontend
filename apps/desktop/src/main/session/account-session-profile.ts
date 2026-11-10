// 从当前可用账号解析会话配置，自动语言使用宿主提供的系统基线，不由代理位置推断。

import { isAccountSelectable } from "@pigclaude/contracts/claude-account"
import type { LocalStore } from "@pigclaude/local-store"

/** 保留指定账号与自动选号的配置选择规则，返回实际会话需要的时区和语言。 */
export async function accountSessionProfile(
  store: Pick<LocalStore, "listAccounts" | "listProxies">,
  accountId: string | null,
  systemLocale: () => string,
): Promise<import("./session-types").SessionProfile | null> {
  const accounts = await store.listAccounts()
  const proxies = new Map((await store.listProxies()).map((proxy) => [proxy.id, proxy.url]))
  const available = accounts.filter((item) =>
    isAccountSelectable(
      {
        enabled: item.enabled,
        needsReauth: item.needsReauth,
        hasCredential: item.credential !== null,
        exhaustedUntil: item.exhaustedUntil,
        proxyUrl: item.proxyId === null ? null : proxies.get(item.proxyId),
      },
      Date.now(),
    ),
  )
  const account =
    accountId === null
      ? available[0]
      : (available.find((item) => item.id === accountId) ?? available[0])
  return account === undefined
    ? null
    : {
        timezone: account.fingerprint.timezone,
        locale: account.fingerprint.lang || systemLocale(),
        browserProfileId: account.browserProfileId,
        profileRevision: account.browserProfileRevision,
        accountId: account.id,
      }
}
