// 更新账号元数据或配置引用，旧主进程环境修改也只写到共享配置本身。

import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { ClaudeAccountServiceDeps } from "./account-service-deps"
import type { UpdateClaudeAccountInput } from "./account-service-inputs"
import { BrowserProfileService } from "./browser-profile-service"
import { BrowserProfileUsage } from "./browser-profile-usage"
import { ClaudeAccountError } from "./errors"
import { toView } from "./account-service-record"
import { ensureFingerprint } from "./fingerprint-args"

/** 保持凭据不变；配置引用改变时不移动或共享账号登录数据。 */
export async function updateClaudeAccount(
  deps: ClaudeAccountServiceDeps,
  input: UpdateClaudeAccountInput,
  now: () => number,
): Promise<ClaudeAccountView> {
  const usage = deps.profileUsage ?? new BrowserProfileUsage()
  const apply = async (): Promise<ClaudeAccountView> => {
    const account = await deps.store.getAccount(input.accountId)
    if (!account) throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号不存在")
    const displayName = input.displayName?.trim() ?? account.displayName
    if (!displayName) throw new ClaudeAccountError("INVALID_INPUT", "账号名称不能为空")
    const profileId = input.browserProfileId ?? account.browserProfileId
    if (!profileId) throw new ClaudeAccountError("FINGERPRINT_INVALID", "账号缺少浏览器配置")
    const release = usage.acquire(profileId, `settings-${account.id}`)
    try {
      const profile = await deps.store.getBrowserProfile(profileId)
      if (!profile) throw new ClaudeAccountError("FINGERPRINT_INVALID", "浏览器配置不存在")
      if (input.fingerprint !== undefined || input.proxyId !== undefined) {
        if (input.browserProfileId !== undefined)
          throw new ClaudeAccountError("INVALID_INPUT", "更换配置引用时不能同时上传环境副本")
        release()
        if (
          input.proxyId !== undefined &&
          input.proxyId !== null &&
          !(await deps.store.getProxy(input.proxyId))
        )
          throw new ClaudeAccountError("PROXY_INVALID", "代理不存在")
        if (input.fingerprint !== undefined) {
          const validation = ensureFingerprint(input.fingerprint, profileId)
          if (!validation.ok)
            throw new ClaudeAccountError("FINGERPRINT_INVALID", validation.message)
        }
        const service = new BrowserProfileService({
          store: deps.store,
          usage,
          systemLocale: deps.systemLocale,
          systemTimezone: deps.systemTimezone,
        })
        await service.save({
          id: profile.id,
          revision: profile.revision,
          name: profile.name,
          fingerprint: input.fingerprint ?? profile.fingerprint,
          proxyId: input.proxyId === undefined ? profile.proxyId : input.proxyId,
        })
      }
      const updated = await deps.store.updateAccount(account.id, (current) => ({
        ...current,
        ...(input.browserProfileId === undefined
          ? {}
          : { browserProfileId: input.browserProfileId }),
        displayName: input.displayName === undefined ? current.displayName : displayName,
        enabled: input.enabled ?? current.enabled,
        updatedAt: new Date(now()).toISOString(),
      }))
      if (!updated) throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号不存在")
      return toView(updated)
    } finally {
      release()
    }
  }
  return input.browserProfileId === undefined ? apply() : usage.editAccount(input.accountId, apply)
}
