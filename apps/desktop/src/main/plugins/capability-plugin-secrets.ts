// 让插件表单和 Worker 能力共享同一个加密文件写队列，拒绝 Linux 的明文密码后端。
import { FileSecretVault, type SafeStoragePort } from "../secret-vault"
import { capabilityPluginStoragePaths } from "./capability-plugin-paths"

type PlatformStorage = SafeStoragePort & { getSelectedStorageBackend(): string }

/** 每次桌面装配持有一份，调用方须先校验插件身份与密钥权限。 */
export class CapabilityPluginSecrets {
  readonly #vaults = new Map<string, FileSecretVault>()

  /** 绑定唯一插件安装根以及已验证的平台安全存储端口。 */
  constructor(
    private readonly root: string,
    private readonly secureStorage: SafeStoragePort,
  ) {}

  /** 读取存在的字段名，不解密，供设置页提供配置状态。 */
  keys(pluginId: string): Promise<readonly string[]> {
    return this.#vault(pluginId).keys()
  }

  /** 返回这个插件自己的密钥值，缺少密钥时返回 null。 */
  async read(pluginId: string, key: string): Promise<string | null> {
    this.#requireEncryption()
    return this.#vault(pluginId).get(key)
  }

  /** 原子保存或清除一个字段。相同插件文件的表单和 Worker 写入共享队列。 */
  async write(pluginId: string, key: string, value: string | null): Promise<void> {
    this.#requireEncryption()
    const vault = this.#vault(pluginId)
    if (value === null) await vault.delete(key)
    else await vault.set(key, value)
  }

  #vault(pluginId: string): FileSecretVault {
    const cached = this.#vaults.get(pluginId)
    if (cached) return cached
    const { secretsFile } = capabilityPluginStoragePaths(this.root, pluginId)
    const vault = new FileSecretVault(secretsFile, this.secureStorage)
    this.#vaults.set(pluginId, vault)
    return vault
  }

  #requireEncryption(): void {
    if (!this.secureStorage.isEncryptionAvailable())
      throw new Error("PLUGIN_SECRET_STORAGE_UNAVAILABLE")
  }
}

/** 连接 Electron safeStorage，只有真实系统密钥库可加密或解密插件密钥。 */
export function createCapabilityPluginSecrets(
  root: string,
  storage: PlatformStorage,
  platform: NodeJS.Platform = process.platform,
): CapabilityPluginSecrets {
  return new CapabilityPluginSecrets(root, {
    isEncryptionAvailable: () => {
      if (!storage.isEncryptionAvailable()) return false
      if (platform !== "linux") return true
      const backend = storage.getSelectedStorageBackend()
      return backend !== "basic_text" && backend !== "unknown"
    },
    encryptString: (value) => storage.encryptString(value),
    decryptString: (value) => storage.decryptString(value),
  })
}
