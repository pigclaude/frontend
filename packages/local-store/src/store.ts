// 在本机数据目录保存账号、明文凭据、用户设置的指纹和 IP 代理池。

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { normalizeFingerprint, parseAccountRecord, parseProxy } from "./schema"
import type { AccountRecord, IpProxy } from "./schema"

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

/** 账号局部更新或按当前记录计算新记录；updater 返回 null 表示跳过这次写入。 */
export type AccountUpdate =
  Partial<Omit<AccountRecord, "id">> | ((account: AccountRecord) => AccountRecord | null)

/** 读写本机 proxies.json 与 accounts.json。保证按 id 覆盖，同一文件的保存排队，凭据不加密，文件留在本机。 */
export class LocalStore {
  readonly #dataDir: string
  readonly #writes = new Map<string, Promise<void>>()

  /** 保证后续读写都落在这个数据目录。 */
  constructor(dataDir: string) {
    this.#dataDir = dataDir
  }

  /** 按 id 保存或覆盖一条代理。保证同一文件里交错的保存不会丢掉另一条，并且文件被完整替换。 */
  async saveProxy(proxy: IpProxy): Promise<void> {
    await this.enqueue(this.proxiesPath(), async () => {
      const proxies = replaceById(await readProxies(this.proxiesPath()), proxy)
      await writeJson(this.proxiesPath(), proxies)
    })
  }

  /** 按 id 删除一条代理。保证文件不存在或记录不存在时不报错。 */
  async removeProxy(id: string): Promise<void> {
    await this.enqueue(this.proxiesPath(), async () => {
      const proxies = await readProxies(this.proxiesPath())
      await writeJson(
        this.proxiesPath(),
        proxies.filter((proxy) => proxy.id !== id),
      )
    })
  }

  /** 按 id 读取代理。保证没有这条记录时返回 null。 */
  async getProxy(id: string): Promise<IpProxy | null> {
    const proxies = await readProxies(this.proxiesPath())
    return proxies.find((proxy) => proxy.id === id) ?? null
  }

  /** 返回全部已保存代理。保证文件不存在时返回空数组。 */
  async listProxies(): Promise<IpProxy[]> {
    return readProxies(this.proxiesPath())
  }

  /** 按 id 保存或覆盖一条账号。保证明文写入 credential，保留指纹，同一文件里交错的保存不会丢掉另一条。 */
  async saveAccount(account: AccountRecord): Promise<void> {
    await this.enqueue(this.accountsPath(), async () => {
      const accounts = replaceById(await readAccounts(this.accountsPath()), account)
      await writeJson(this.accountsPath(), accounts)
    })
  }

  /**
   * 在写入队列内原子更新一条账号：读取最新记录、应用局部字段或 updater，再整体写回。
   * 保证账号已被删除时返回 null 且不复活；updater 返回 null 时跳过写入。
   */
  async updateAccount(id: string, update: AccountUpdate): Promise<AccountRecord | null> {
    let updated: AccountRecord | null = null
    await this.enqueue(this.accountsPath(), async () => {
      const accounts = await readAccounts(this.accountsPath())
      const index = accounts.findIndex((account) => account.id === id)
      if (index < 0) return
      const current = accounts[index]
      if (current === undefined) return
      const next = typeof update === "function" ? update(current) : { ...current, ...update }
      if (next === null) return
      const committed: AccountRecord = { ...next, id: current.id }
      updated = committed
      await writeJson(
        this.accountsPath(),
        accounts.map((account, itemIndex) => (itemIndex === index ? committed : account)),
      )
    })
    return updated
  }

  /** 按 id 删除一条账号。保证文件不存在或记录不存在时不报错。 */
  async removeAccount(id: string): Promise<void> {
    await this.enqueue(this.accountsPath(), async () => {
      const accounts = await readAccounts(this.accountsPath())
      await writeJson(
        this.accountsPath(),
        accounts.filter((account) => account.id !== id),
      )
    })
  }

  /** 按 id 读取账号。保证没有这条记录时返回 null。 */
  async getAccount(id: string): Promise<AccountRecord | null> {
    const accounts = await readAccounts(this.accountsPath())
    return accounts.find((account) => account.id === id) ?? null
  }

  /** 返回全部已保存账号。保证文件不存在时返回空数组，旧记录在读取时迁移为 v2。 */
  async listAccounts(): Promise<AccountRecord[]> {
    return readAccounts(this.accountsPath())
  }

  private accountsPath(): string {
    return join(this.#dataDir, "accounts.json")
  }

  private proxiesPath(): string {
    return join(this.#dataDir, "proxies.json")
  }

  // 同一路径的写入排队。后一次要等前一次 rename 完成后再读，避免用旧快照盖掉刚写入的记录。
  private enqueue(path: string, write: () => Promise<void>): Promise<void> {
    const previous = this.#writes.get(path) ?? Promise.resolve()
    const run = previous.then(write, write)
    this.#writes.set(
      path,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }
}

function replaceById<T extends { id: string }>(items: readonly T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index < 0) return [...items, next]
  return items.map((item, itemIndex) => (itemIndex === index ? next : item))
}

async function readAccounts(path: string): Promise<AccountRecord[]> {
  return readList(path, parseAccountRecord)
}

async function readProxies(path: string): Promise<IpProxy[]> {
  return readList(path, parseProxy)
}

async function readList<T>(path: string, parse: (value: unknown) => T | null): Promise<T[]> {
  const parsed = await readJson(path)
  if (parsed === undefined) return []
  if (!Array.isArray(parsed)) throw new Error(`${basename(path)} 不是列表`)
  const items: T[] = []
  for (const item of parsed) {
    const record = parse(item)
    if (record === null) throw new Error(`${basename(path)} 不是列表`)
    items.push(record)
  }
  return items
}

async function readJson(path: string): Promise<unknown> {
  try {
    const text = await readFile(path, "utf8")
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    if (isEnoent(error)) return undefined
    throw error
  }
}

// 先写同目录临时文件，再 rename 覆盖目标，避免读到半截 JSON；文件和临时文件都只给当前用户读写。
async function writeJson(path: string, value: readonly unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 })
    await rename(temporary, path)
  } catch (error: unknown) {
    await rm(temporary, { force: true })
    throw error
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
