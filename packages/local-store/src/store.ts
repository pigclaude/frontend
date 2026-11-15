// 管理本机账号引用、独立浏览器配置与代理；变更排队，兼容迁移保留原始备份。

import { join } from "node:path"
import { normalizeFingerprint, parseProxy, type AccountRecord, type IpProxy } from "./schema"
import { parseBrowserProfile, type BrowserProfileRecord } from "./browser-profile"
import { parseStoredAccount, toAccountReference, type AccountReference } from "./account-reference"
import { backupLocalJson, readStoredList, replaceStoredItem, writeStoredList } from "./local-json"

export { normalizeFingerprint }
export type {
  AccountRecord,
  FingerprintConfig,
  FingerprintNoise,
  FingerprintSpoofingCategory,
  FingerprintWebrtcPolicy,
  IpProxy,
  ProxyTestResult,
} from "./schema"
export type { ClaudeCredential } from "./credential"
export type { BrowserProfileRecord } from "./browser-profile"
export type { AccountReference } from "./account-reference"

/** 账号局部更新；环境属于实例，不通过账号更新另存副本。 */
export type AccountUpdate =
  | Partial<Omit<AccountRecord, "id" | "fingerprint" | "proxyId" | "browserProfileDir">>
  | ((account: AccountRecord) => AccountRecord | null)

/** 迁移自动项时由真实宿主提供系统基线。 */
export type LocalStoreOptions = { systemLocale?: () => string; systemTimezone?: () => string }

/** 本机数据的单一写入队列；读取账号时解引用实例，避免两份环境配置分叉。 */
export class LocalStore {
  readonly #dataDir: string
  readonly #options: LocalStoreOptions
  readonly #accountListeners = new Set<() => void>()
  #writes: Promise<void> = Promise.resolve()

  /** 绑定本机目录和旧自动配置基线，不在构造时访问文件。 */
  constructor(dataDir: string, options: LocalStoreOptions = {}) {
    this.#dataDir = dataDir
    this.#options = options
  }

  /** 账号成功写入后向本机观察者发送无数据通知；返回取消订阅函数。 */
  subscribeAccounts(listener: () => void): () => void {
    this.#accountListeners.add(listener)
    return () => this.#accountListeners.delete(listener)
  }

  /** 返回独立实例；旧账号先完成可重试迁移。 */
  async listBrowserProfiles(): Promise<BrowserProfileRecord[]> {
    await this.#migrate()
    return (await this.#readProfiles()).items
  }

  /** 没有实例时返回 null，不创建账号私有副本。 */
  async getBrowserProfile(id: string): Promise<BrowserProfileRecord | null> {
    return (await this.listBrowserProfiles()).find((profile) => profile.id === id) ?? null
  }

  /** 原子保存可复用实例；更新必须推进一版，账号登录数据不属于配置记录。 */
  async saveBrowserProfile(profile: BrowserProfileRecord): Promise<void> {
    await this.#migrate()
    await this.#enqueue(async () => {
      const stored = await this.#readProfiles()
      const current = stored.items.find((item) => item.id === profile.id)
      if (current && profile.revision !== current.revision + 1)
        throw new Error("BROWSER_PROFILE_CONFLICT: 浏览器配置版本已变化")
      await writeStoredList(this.#profilesPath(), {
        items: replaceStoredItem(stored.items, profile),
        invalid: stored.invalid,
      })
    })
  }

  /** 仅删除未绑定实例记录，进程和真实目录须由主进程先确认清理。 */
  async removeBrowserProfile(id: string): Promise<void> {
    await this.#migrate()
    await this.#enqueue(async () => {
      const accounts = await this.#readAccounts()
      if (
        accounts.items.some((account) => account.browserProfileId === id) ||
        accounts.invalid.some((value) => rawReference(value, "browserProfileId", id))
      )
        throw new Error("BROWSER_PROFILE_IN_USE: 浏览器实例仍被账号绑定")
      const stored = await this.#readProfiles()
      await writeStoredList(this.#profilesPath(), {
        items: stored.items.filter((profile) => profile.id !== id),
        invalid: stored.invalid,
      })
    })
  }

  /** 保存代理并保留无法解析的未来记录。 */
  async saveProxy(proxy: IpProxy): Promise<void> {
    await this.#enqueue(async () => {
      const stored = await this.#readProxies()
      await writeStoredList(this.#proxiesPath(), {
        items: replaceStoredItem(stored.items, proxy),
        invalid: stored.invalid,
      })
    })
  }

  /** 拒绝删除被实例引用的代理，防止意外解绑或直连。 */
  async removeProxy(id: string): Promise<void> {
    await this.#migrate()
    await this.#enqueue(async () => {
      const profiles = await this.#readProfiles()
      if (
        profiles.items.some((profile) => profile.proxyId === id) ||
        profiles.invalid.some((value) => rawReference(value, "proxyId", id))
      )
        throw new Error("PROXY_IN_USE: 代理仍被浏览器实例绑定")
      const stored = await this.#readProxies()
      await writeStoredList(this.#proxiesPath(), {
        items: stored.items.filter((proxy) => proxy.id !== id),
        invalid: stored.invalid,
      })
    })
  }

  /** 按 id 返回代理，缺失时不回退其他代理。 */
  async getProxy(id: string): Promise<IpProxy | null> {
    return (await this.#readProxies()).items.find((proxy) => proxy.id === id) ?? null
  }

  /** 返回全部有效代理，缺文件时为空列表。 */
  async listProxies(): Promise<IpProxy[]> {
    return (await this.#readProxies()).items
  }

  /** 保存账号引用，兼容旧调用；多个账号可引用同一配置，登录数据仍由各自 id 隔离。 */
  async saveAccount(account: AccountRecord | AccountReference): Promise<void> {
    await this.#migrate()
    await this.#enqueue(async () => {
      const stored = await this.#readAccounts()
      let profileId = account.browserProfileId
      if (!profileId && "fingerprint" in account) {
        const profiles = await this.#readProfiles()
        profileId = account.id
        const existing = profiles.items.find((profile) => profile.id === profileId)
        if (existing && existing.legacyAccountId !== account.id)
          throw new Error("BROWSER_PROFILE_CONFLICT: 旧账号的浏览器标识已被占用")
        if (!existing)
          await writeStoredList(this.#profilesPath(), {
            items: [...profiles.items, this.#legacyProfile(account)],
            invalid: profiles.invalid,
          })
      }
      if (!profileId || !(await this.#readProfiles()).items.some((item) => item.id === profileId))
        throw new Error("BROWSER_PROFILE_NOT_FOUND: 浏览器实例配置不存在")
      await writeStoredList(this.#accountsPath(), {
        items: replaceStoredItem(stored.items, toAccountReference(account, profileId)),
        invalid: stored.invalid,
      })
    })
    this.#notifyAccounts()
  }

  /** 在队列内读取最新账号再更新，删除后不复活，环境字段不写回为账号副本。 */
  async updateAccount(id: string, update: AccountUpdate): Promise<AccountRecord | null> {
    await this.#migrate()
    let updated: AccountRecord | null = null
    await this.#enqueue(async () => {
      const stored = await this.#readAccounts()
      const current = stored.items.find((account) => account.id === id)
      if (!current || !current.browserProfileId) return
      const resolved = this.#resolve(current, (await this.#readProfiles()).items)
      const next = typeof update === "function" ? update(resolved) : { ...resolved, ...update }
      if (next === null) return
      const profileId = next.browserProfileId ?? current.browserProfileId
      const reference = toAccountReference({ ...next, id }, profileId)
      updated = this.#resolve(reference, (await this.#readProfiles()).items)
      await writeStoredList(this.#accountsPath(), {
        items: replaceStoredItem(stored.items, reference),
        invalid: stored.invalid,
      })
    })
    if (updated !== null) this.#notifyAccounts()
    return updated
  }

  /** 删除账号凭据和引用，独立实例与浏览器数据保留。 */
  async removeAccount(id: string): Promise<void> {
    await this.#migrate()
    await this.#enqueue(async () => {
      const stored = await this.#readAccounts()
      await writeStoredList(this.#accountsPath(), {
        items: stored.items.filter((account) => account.id !== id),
        invalid: stored.invalid,
      })
    })
    this.#notifyAccounts()
  }

  /** 返回账号当前实例的解引用视图，缺实例时明确报错。 */
  async getAccount(id: string): Promise<AccountRecord | null> {
    return (await this.listAccounts()).find((account) => account.id === id) ?? null
  }

  /** 返回当前实例环境，不从旧账号快照猜测或回退宿主环境。 */
  async listAccounts(): Promise<AccountRecord[]> {
    await this.#migrate()
    const stored = await this.#readAccounts()
    const profiles = (await this.#readProfiles()).items
    return stored.items.map((account) => this.#resolve(account, profiles))
  }

  #resolve(
    account: AccountReference | AccountRecord,
    profiles: BrowserProfileRecord[],
  ): AccountRecord {
    const profile = profiles.find((item) => item.id === account.browserProfileId)
    if (!profile) throw new Error("BROWSER_PROFILE_NOT_FOUND: 账号关联的浏览器实例缺失")
    return {
      ...toAccountReference(account, profile.id),
      browserProfileRevision: profile.revision,
      fingerprint: structuredClone(profile.fingerprint),
      proxyId: profile.proxyId,
      browserProfileDir: "",
    }
  }

  async #migrate(): Promise<void> {
    await this.#enqueue(async () => {
      const accounts = await this.#readAccounts()
      const legacy = accounts.items.filter(
        (account): account is AccountRecord => "fingerprint" in account,
      )
      if (!legacy.length) return
      await backupLocalJson(
        this.#accountsPath(),
        join(this.#dataDir, "migration-backups", "browser-profiles-v1-accounts.json"),
      )
      const profiles = await this.#readProfiles()
      for (const account of legacy) {
        const existing = profiles.items.find((profile) => profile.id === account.id)
        if (existing && existing.legacyAccountId !== account.id)
          throw new Error("BROWSER_PROFILE_CONFLICT: 旧账号的浏览器标识已被占用")
        if (!existing) profiles.items.push(this.#legacyProfile(account))
      }
      await writeStoredList(this.#profilesPath(), profiles)
      await writeStoredList(this.#accountsPath(), {
        items: accounts.items.map((account) =>
          toAccountReference(account, account.browserProfileId ?? account.id),
        ),
        invalid: accounts.invalid,
      })
    })
  }

  #legacyProfile(account: AccountRecord): BrowserProfileRecord {
    const locale = this.#options.systemLocale?.() ?? Intl.DateTimeFormat().resolvedOptions().locale
    const timezone =
      this.#options.systemTimezone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    const profile: BrowserProfileRecord = {
      schemaVersion: 1,
      id: account.id,
      legacyAccountId: account.id,
      name: `${account.displayName} 的浏览器`,
      proxyId: account.proxyId,
      fingerprint: {
        ...account.fingerprint,
        lang: account.fingerprint.lang || locale,
        timezone:
          !account.fingerprint.timezone || account.fingerprint.timezone.toLowerCase() === "system"
            ? timezone
            : account.fingerprint.timezone,
      },
      revision: 1,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    }
    if (!parseBrowserProfile(profile))
      throw new Error("BROWSER_PROFILE_CONFLICT: 旧浏览器数据标识无法安全迁移")
    return profile
  }

  #accountsPath(): string {
    return join(this.#dataDir, "accounts.json")
  }
  #profilesPath(): string {
    return join(this.#dataDir, "browser-profiles.json")
  }
  #proxiesPath(): string {
    return join(this.#dataDir, "proxies.json")
  }
  #readAccounts() {
    return readStoredList(this.#accountsPath(), parseStoredAccount)
  }
  #readProfiles() {
    return readStoredList(this.#profilesPath(), parseBrowserProfile)
  }
  #readProxies() {
    return readStoredList(this.#proxiesPath(), parseProxy)
  }
  #notifyAccounts(): void {
    for (const listener of [...this.#accountListeners]) {
      try {
        listener()
      } catch {
        // 订阅者失效不改变已经完成的写入。
      }
    }
  }
  #enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.#writes.then(operation, operation)
    this.#writes = run.catch(() => undefined)
    return run
  }
}

function rawReference(value: unknown, key: string, id: string): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    key in value &&
    (value as Record<string, unknown>)[key] === id
  )
}
