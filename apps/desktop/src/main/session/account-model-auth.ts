// 负责为模型目录查询挑一个可用账号并刷新凭据；返回的 token 只用于一次性的模型探测。

import { isAccountSelectable } from "@pigclaude/contracts/claude-account"
import type { LocalStore } from "@pigclaude/local-store"
import type { CredentialRefresher } from "../claude/credential-refresher"
import type { ModelAuth } from "./session-environment"

/** 选第一个可用账号（或指定账号），刷新即将过期的凭据；缺少 org 时返回 null。 */
export async function accountModelAuth(
  store: Pick<LocalStore, "listAccounts" | "listProxies">,
  refresher: Pick<CredentialRefresher, "refreshIfNeeded">,
  accountId: string | null,
  now = Date.now(),
): Promise<ModelAuth | null> {
  const accounts = await store.listAccounts()
  const proxies = new Map((await store.listProxies()).map((proxy) => [proxy.id, proxy.url]))
  const available = accounts.filter((account) =>
    isAccountSelectable(
      {
        enabled: account.enabled,
        needsReauth: account.needsReauth,
        hasCredential: account.credential !== null,
        exhaustedUntil: account.exhaustedUntil,
        proxyUrl: account.proxyId === null ? null : proxies.get(account.proxyId),
      },
      now,
    ),
  )
  const account =
    accountId === null
      ? available[0]
      : (available.find((item) => item.id === accountId) ?? available[0])
  if (account?.credential === null || account?.credential === undefined) return null
  const refreshed = await refresher.refreshIfNeeded(account).catch(() => null)
  const credential = refreshed?.credential ?? account.credential
  if (credential.accountUuid === null || credential.organizationUuid === null) return null
  return {
    accessToken: credential.accessToken,
    accountUuid: credential.accountUuid,
    email: credential.email ?? "",
    organizationUuid: credential.organizationUuid,
  }
}
