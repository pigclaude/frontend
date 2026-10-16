// 在本机数据目录保存账号、明文凭据、用户设置的指纹和 IP 代理池。

import { randomUUID } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

/** 一个账号的指纹配置。保证种子、品牌、平台、语言、时区、画布噪声和 client rects 噪声一起保存。 */
export type FingerprintConfig = {
  seed: string
  brand: string
  platform: string
  lang: string
  timezone: string
  canvasNoise: boolean
  clientRectsNoise: boolean
}

/** 代理池里的一条 IP 代理。保证用 id 标识，url 是代理地址。 */
export type IpProxy = {
  id: string
  url: string
}

/** 本机一条账号记录。保证凭据明文放在 credential，并绑定一条代理和一份用户设置的指纹。 */
export type AccountRecord = {
  id: string
  enabled: boolean
  credential: string
  proxyId: string
  fingerprint: FingerprintConfig
  exhaustedUntil: string | null
}

/** 读写本机 proxies.json 与 accounts.json。保证按 id 覆盖，凭据不加密，文件留在本机。 */
export class LocalStore {
  readonly #dataDir: string

  /** 保证后续读写都落在这个数据目录。 */
  constructor(dataDir: string) {
    this.#dataDir = dataDir
  }

  /** 按 id 保存或覆盖一条代理。保证 proxies.json 被完整替换，而不是留下半截内容。 */
  async saveProxy(proxy: IpProxy): Promise<void> {
    const proxies = replaceById(await readProxies(this.proxiesPath()), proxy)
    await writeJson(this.proxiesPath(), proxies)
  }

  /** 按 id 保存或覆盖一条账号。保证 credential 按传入明文写入，指纹原样保留。 */
  async saveAccount(account: AccountRecord): Promise<void> {
    const accounts = replaceById(await readAccounts(this.accountsPath()), account)
    await writeJson(this.accountsPath(), accounts)
  }

  /** 按 id 读取账号。保证没有这条记录时返回 null。 */
  async getAccount(id: string): Promise<AccountRecord | null> {
    const accounts = await readAccounts(this.accountsPath())
    return accounts.find((account) => account.id === id) ?? null
  }

  /** 返回全部已保存账号。保证文件不存在时返回空数组。 */
  async listAccounts(): Promise<AccountRecord[]> {
    return readAccounts(this.accountsPath())
  }

  private accountsPath(): string {
    return join(this.#dataDir, "accounts.json")
  }

  private proxiesPath(): string {
    return join(this.#dataDir, "proxies.json")
  }
}

function replaceById<T extends { id: string }>(items: readonly T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index < 0) return [...items, next]
  return items.map((item, itemIndex) => (itemIndex === index ? next : item))
}

async function readAccounts(path: string): Promise<AccountRecord[]> {
  return readList(path, isAccountRecord)
}

async function readProxies(path: string): Promise<IpProxy[]> {
  return readList(path, isProxy)
}

async function readList<T>(path: string, accept: (value: unknown) => value is T): Promise<T[]> {
  const parsed = await readJson(path)
  if (parsed === undefined) return []
  if (!Array.isArray(parsed)) throw new Error(`${basename(path)} 不是列表`)
  const items: T[] = []
  for (const item of parsed) {
    if (!accept(item)) throw new Error(`${basename(path)} 不是列表`)
    items.push(item)
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

// 先写同目录临时文件，再 rename 覆盖目标，避免读到半截 JSON。
async function writeJson(path: string, value: readonly unknown[]): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(value), "utf8")
    await rename(temporary, path)
  } catch (error: unknown) {
    await rm(temporary, { force: true })
    throw error
  }
}

function isAccountRecord(value: unknown): value is AccountRecord {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.credential === "string" &&
    typeof value.proxyId === "string" &&
    isFingerprint(value.fingerprint) &&
    (value.exhaustedUntil === null || typeof value.exhaustedUntil === "string")
  )
}

function isFingerprint(value: unknown): value is FingerprintConfig {
  if (!isRecord(value)) return false
  return (
    typeof value.seed === "string" &&
    typeof value.brand === "string" &&
    typeof value.platform === "string" &&
    typeof value.lang === "string" &&
    typeof value.timezone === "string" &&
    typeof value.canvasNoise === "boolean" &&
    typeof value.clientRectsNoise === "boolean"
  )
}

function isProxy(value: unknown): value is IpProxy {
  if (!isRecord(value)) return false
  return typeof value.id === "string" && typeof value.url === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isEnoent(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}
