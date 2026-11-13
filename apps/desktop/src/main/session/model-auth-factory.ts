// 负责用本机账号库和官方 OAuth 刷新器组装模型探测用的凭据解析函数。
import type { LocalStore } from "@pigclaude/local-store"
import { CredentialRefresher } from "../claude/credential-refresher"
import { SubscriptionOAuth } from "../claude/subscription-oauth"
import { accountModelAuth } from "./account-model-auth"
import type { ModelAuth } from "./session-environment"

/** 创建 SessionHost 的 resolveModelAuth：每次按账号挑一份可用凭据并在需要时刷新。 */
export function createAccountModelAuth(
  store: Pick<LocalStore, "listAccounts" | "listProxies" | "getProxy" | "updateAccount">,
): (accountId: string | null) => Promise<ModelAuth | null> {
  const refresher = new CredentialRefresher({ store, oauth: new SubscriptionOAuth() })
  return (accountId) => accountModelAuth(store, refresher, accountId)
}
