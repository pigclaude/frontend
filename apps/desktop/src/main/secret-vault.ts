// 负责把授权秘密交给 Electron safeStorage 加密后原子写入本机文件。
import { readFile } from "node:fs/promises"
import { writePrivateFile } from "./private-file"

/** Electron safeStorage 的最小能力，保证测试可以替换平台实现。 */
export type SafeStoragePort = {
  isEncryptionAvailable(): boolean | Promise<boolean>
  encryptString(value: string): Buffer | Promise<Buffer>
  decryptString(value: Buffer): string | Promise<string>
}

/** 授权秘密仓库接口，保证调用方不能读取底层文件格式。 */
export type SecretVault = {
  set(key: string, value: string): Promise<void>
  get(key: string): Promise<string | null>
  delete(key: string): Promise<void>
  /** 删除同一安全命名空间的全部材料，供撤销设备时原子清理。 */
  deletePrefix?: (prefix: string) => Promise<void>
}

/** 使用 safeStorage 写入加密秘密，保证 JSON 文件不包含明文 token。 */
export class FileSecretVault implements SecretVault {
  readonly #path: string
  readonly #safeStorage: SafeStoragePort
  #writes: Promise<void> = Promise.resolve()

  /** 创建绑定到指定加密文件的秘密仓库。 */
  constructor(
    path: string,
    safeStorage: SafeStoragePort,
    private readonly maximumBytes = Number.POSITIVE_INFINITY,
  ) {
    this.#path = path
    this.#safeStorage = safeStorage
  }

  /** 加密并保存一个秘密，保证同一时刻只替换完整 JSON。 */
  async set(key: string, value: string, beforePublish?: () => void): Promise<void> {
    await this.enqueue(async () => {
      await this.assertAvailable()
      const secrets = await this.readSecrets()
      const encrypted = await this.#safeStorage.encryptString(value)
      await this.writeSecrets({ ...secrets, [key]: encrypted.toString("base64") }, beforePublish)
    })
  }

  /** 读取并解密一个秘密，不存在时返回 null。 */
  async get(key: string): Promise<string | null> {
    const secrets = await this.readSecrets()
    const encoded = Object.hasOwn(secrets, key) ? secrets[key] : undefined
    if (encoded === undefined) return null
    await this.assertAvailable()
    return this.#safeStorage.decryptString(Buffer.from(encoded, "base64"))
  }

  /** 读取已保存的字段名，不需要解密保存内容。 */
  async keys(): Promise<readonly string[]> {
    return Object.keys(await this.readSecrets())
  }

  /** 删除一个秘密，保证删除后磁盘文件不再包含该 key。 */
  async delete(key: string, beforePublish?: () => void): Promise<void> {
    await this.enqueue(async () => {
      await this.assertAvailable()
      const secrets = await this.readSecrets()
      if (!Object.hasOwn(secrets, key)) return
      delete secrets[key]
      await this.writeSecrets(secrets, beforePublish)
    })
  }

  /** 删除指定前缀的全部加密材料，保证撤销不会遗漏旧授权记录。 */
  async deletePrefix(prefix: string): Promise<void> {
    await this.enqueue(async () => {
      await this.assertAvailable()
      const secrets = await this.readSecrets()
      let changed = false
      for (const key of Object.keys(secrets)) {
        if (!key.startsWith(prefix)) continue
        delete secrets[key]
        changed = true
      }
      if (changed) await this.writeSecrets(secrets)
    })
  }

  private async assertAvailable(): Promise<void> {
    if (!(await this.#safeStorage.isEncryptionAvailable())) {
      throw new Error("系统安全存储不可用")
    }
  }

  private async readSecrets(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, "utf8"))
      if (!isSecretMap(parsed)) throw new Error("秘密文件格式无效")
      return { ...parsed }
    } catch (error: unknown) {
      if (isEnoent(error)) return {}
      throw error
    }
  }

  private async writeSecrets(
    secrets: Record<string, string>,
    beforePublish?: () => void,
  ): Promise<void> {
    const contents = JSON.stringify(secrets)
    if (Buffer.byteLength(contents) > this.maximumBytes) throw new Error("秘密文件超过大小限制")
    await writePrivateFile(this.#path, contents, beforePublish)
  }

  private enqueue(write: () => Promise<void>): Promise<void> {
    const previous = this.#writes
    const next = previous.then(write, write)
    this.#writes = next.catch(() => undefined)
    return next
  }
}

function isSecretMap(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isEnoent(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}
