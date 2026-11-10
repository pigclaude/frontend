// 复制已明确确认的 CLI 凭据到本机账号库，保留原 CLI 凭据并沿用账号绑定的共享配置。

import { isDeepStrictEqual } from "node:util"
import type { AccountRecord } from "@pigclaude/local-store"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { ClaudeAccountServiceDeps } from "./account-service-deps"
import type { ImportClaudeCliAccountInput } from "./account-service-inputs"
import { readClaudeCliCredential } from "./cli-credential-reader"
import { readClaudeCliAccountMetadata } from "./cli-account-metadata"
import {
  assertClaudeCliIdentity,
  buildClaudeCliAccountRecord,
  buildClaudeCliCredential,
  claudeCliDisplayName,
  claudeCliImportMessages,
  findClaudeCliAccount,
  mergeClaudeCliIdentity,
} from "./claude-cli-import"
import { mapError, requireMembership } from "./account-service-errors"
import { readOptionalOAuthProfile } from "./account-service-oauth-profile"
import { accountBrowserProfile } from "./account-browser-profile"
import type { AccountBrowserProfile } from "./account-browser-profile"
import { createProxyAgent } from "@pigclaude/proxy-connection"
import { toView } from "./account-service-record"
import { ClaudeAccountError } from "./errors"

/** 从已确认的只读 CLI 来源复制凭据；新产品请求选择实例，身份去重保留已有账号环境。 */
export async function importClaudeCliAccount(
  deps: ClaudeAccountServiceDeps,
  input: ImportClaudeCliAccountInput,
  options: { now: () => number; id: () => string },
): Promise<ClaudeAccountView> {
  if (input.confirmCopy !== true)
    throw new ClaudeAccountError("INVALID_INPUT", claudeCliImportMessages.confirmCopy)
  const newId = options.id()
  const snapshots: AccountBrowserProfile[] = []
  try {
    await requireMembership(() => deps.ensureMembership())
    const resolve = async (id: string, accountId: string) => {
      const snapshot = await accountBrowserProfile(
        deps.store,
        { displayName: input.displayName ?? "CLI 导入账号", browserProfileId: id },
        accountId,
        {
          usage: deps.profileUsage,
          systemLocale: deps.systemLocale,
          systemTimezone: deps.systemTimezone,
        },
      )
      snapshots.push(snapshot)
      return snapshot
    }
    const requested = input.browserProfileId ? await resolve(input.browserProfileId, newId) : null
    const cli = await (
      deps.readCliCredential ?? (() => readClaudeCliCredential({ configDir: null }))
    )()
    const metadata = await (
      deps.readCliAccountMetadata ?? (() => readClaudeCliAccountMetadata({ configDir: null }))
    )()
    if (!Number.isFinite(cli.expiresAt) || cli.expiresAt <= options.now() + 60_000)
      throw new ClaudeAccountError("CLI_CREDENTIAL_EXPIRED", claudeCliImportMessages.expired)
    const profile = await readOptionalOAuthProfile(async () => {
      const dispatcher = requested?.proxy ? createProxyAgent(requested.proxy.url) : undefined
      try {
        return await deps.oauth.readProfile({
          accessToken: cli.accessToken,
          signal: AbortSignal.timeout(12_000),
          ...(dispatcher ? { dispatcher } : {}),
        })
      } finally {
        if (dispatcher) {
          try {
            await dispatcher.close()
          } catch {
            await dispatcher.destroy()
          }
        }
      }
    })
    const identity = mergeClaudeCliIdentity(cli, metadata, profile)
    const existing = findClaudeCliAccount(await deps.store.listAccounts(), identity)
    assertClaudeCliIdentity(existing, identity)
    const selectedId = existing?.browserProfileId ?? input.browserProfileId
    const selected =
      requested?.browserProfileId === selectedId
        ? requested
        : selectedId
          ? await resolve(selectedId, existing?.id ?? newId)
          : null
    await selected?.assertCurrent()
    const makeRecord = (current: AccountRecord | null): AccountRecord => {
      assertClaudeCliIdentity(current, identity)
      const displayName =
        current !== null && input.displayName === undefined
          ? current.displayName
          : claudeCliDisplayName(input.displayName ?? "", metadata, identity.email)
      const record = buildClaudeCliAccountRecord({
        existing: current,
        newId,
        displayName,
        credential: buildClaudeCliCredential(cli, identity, current?.credential ?? null),
        browserProfileDir: current?.browserProfileDir ?? deps.browser.profileDir(newId),
        now: new Date(options.now()).toISOString(),
      })
      return selected
        ? {
            ...record,
            browserProfileId: selected.browserProfileId,
            fingerprint: selected.fingerprint,
            proxyId: selected.proxyId,
          }
        : record
    }
    if (!existing) {
      const record = makeRecord(null)
      await deps.store.saveAccount(record)
      const saved = await deps.store.getAccount(record.id)
      if (!saved) throw new ClaudeAccountError("STORAGE_FAILED", "导入后账号不存在")
      return toView(saved)
    }
    const updated = await deps.store.updateAccount(existing.id, (current) => {
      if (!isDeepStrictEqual(current.credential, existing.credential))
        throw new ClaudeAccountError("INVALID_INPUT", "账号凭据已更新，请重新导入")
      if (current.browserProfileId !== existing.browserProfileId)
        throw new ClaudeAccountError("INVALID_INPUT", "账号关联配置已更新，请重新导入")
      return makeRecord(current)
    })
    if (!updated) throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号不存在")
    return toView(updated)
  } catch (error: unknown) {
    throw mapError(error)
  } finally {
    for (const snapshot of snapshots) snapshot.release()
  }
}
