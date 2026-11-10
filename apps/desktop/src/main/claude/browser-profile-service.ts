// 独立管理号池中的浏览器配置，保存时固化环境，账号和 CLI 只能引用同一记录。

import { randomUUID } from "node:crypto"
import type { LocalStore, BrowserProfileRecord } from "@pigclaude/local-store"
import type {
  BrowserProfileView,
  SaveBrowserProfileInput,
  BrowserProfileRegion,
} from "@pigclaude/contracts/browser-profile"
import { ensureFingerprint } from "./fingerprint-args"
import { launchArgumentConflict } from "./launch-argument-guard"
import { BrowserProfileUsage } from "./browser-profile-usage"
import { browserProfileRegion } from "./browser-profile-region"
import { systemLocale, systemTimezone } from "../session/session-locale"

/** 主进程配置依赖；地区查询和进程适配器均属于外部可替换端口。 */
export type BrowserProfileServiceOptions = {
  store: LocalStore
  usage: BrowserProfileUsage
  systemLocale?: () => string
  systemTimezone?: () => string
  readRegion?: (proxyUrl: string) => Promise<BrowserProfileRegion>
  id?: () => string
  now?: () => number
}

/** 号池配置的公开管理入口，不在新建配置时启动浏览器或读取账号凭据。 */
export class BrowserProfileService {
  readonly #options: BrowserProfileServiceOptions
  /** 绑定实例存储、使用权与本机浏览器资源。 */
  constructor(options: BrowserProfileServiceOptions) {
    this.#options = options
  }

  /** 返回无凭据、无绝对路径的配置及真实绑定状态。 */
  async list(): Promise<BrowserProfileView[]> {
    const profiles = await this.#options.store.listBrowserProfiles()
    const accounts = await this.#options.store.listAccounts()
    return profiles.map((profile) => {
      const bound = accounts.filter((item) => item.browserProfileId === profile.id)
      return {
        id: profile.id,
        name: profile.name,
        proxyId: profile.proxyId,
        fingerprint: profile.fingerprint,
        revision: profile.revision,
        boundAccounts: bound.map((account) => ({ id: account.id, name: account.displayName })),
        inUse: this.#options.usage.inUse(profile.id),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      }
    })
  }

  /** 保存实例本身；账号向导不能覆盖这些配置，在用和版本失配时拒绝写入。 */
  async save(input: SaveBrowserProfileInput): Promise<BrowserProfileView> {
    const id = input.id ?? (this.#options.id ?? randomUUID)()
    await this.#options.usage.edit(id, async () => {
      const existing = input.id ? await this.#options.store.getBrowserProfile(id) : null
      if (input.id && !existing) throw new Error("BROWSER_PROFILE_NOT_FOUND: 浏览器实例不存在")
      if (existing && input.revision !== existing.revision)
        throw new Error("BROWSER_PROFILE_CONFLICT: 配置已变化，请刷新")
      const name = input.name.trim()
      if (!name) throw new Error("浏览器实例名称不能为空")
      const proxy =
        input.proxyId === null ? null : await this.#options.store.getProxy(input.proxyId)
      if (input.proxyId !== null && !proxy) throw new Error("实例绑定的代理不存在")
      if (
        proxy &&
        (!input.fingerprint.lang ||
          !input.fingerprint.timezone ||
          input.fingerprint.timezone === "system")
      )
        throw new Error("请先按代理出口初始化或明确设置语言和时区")
      const validation = ensureFingerprint(
        {
          ...input.fingerprint,
          lang: input.fingerprint.lang || (this.#options.systemLocale ?? systemLocale)(),
          timezone:
            !input.fingerprint.timezone || input.fingerprint.timezone === "system"
              ? (this.#options.systemTimezone ?? systemTimezone)()
              : input.fingerprint.timezone,
        },
        id,
      )
      if (!validation.ok) throw new Error(validation.message)
      const conflict = launchArgumentConflict(
        validation.fingerprint.unknownArgs ?? [],
        proxy !== null,
        undefined,
        validation.fingerprint.webrtcPolicy,
      )
      if (conflict) throw new Error(conflict)
      const timestamp = new Date((this.#options.now ?? Date.now)()).toISOString()
      const profile: BrowserProfileRecord = {
        schemaVersion: 1,
        id,
        name,
        proxyId: input.proxyId,
        fingerprint: validation.fingerprint,
        revision: (existing?.revision ?? 0) + 1,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...(existing?.legacyAccountId ? { legacyAccountId: existing.legacyAccountId } : {}),
      }
      await this.#options.store.saveBrowserProfile(profile)
    })
    const result = (await this.list()).find((profile) => profile.id === id)
    if (!result) throw new Error("浏览器配置保存后不可读取")
    return result
  }

  /** 只删除未引用、未使用配置；账号登录数据不属于共享配置，不在这里清除。 */
  async remove(id: string): Promise<void> {
    await this.#options.usage.edit(id, async () => {
      const profile = await this.#options.store.getBrowserProfile(id)
      if (!profile) return
      if (
        (await this.#options.store.listAccounts()).some(
          (account) => account.browserProfileId === id,
        )
      )
        throw new Error("BROWSER_PROFILE_IN_USE: 请先解除账号绑定")
      await this.#options.store.removeBrowserProfile(id)
    })
  }

  /** 仅用所选代理实际出口给出地区建议，未确认时不猜测或修改配置。 */
  async region(proxyId: string): Promise<BrowserProfileRegion> {
    const proxy = await this.#options.store.getProxy(proxyId)
    if (!proxy) throw new Error("代理不存在")
    return (this.#options.readRegion ?? browserProfileRegion)(proxy.url)
  }
}
