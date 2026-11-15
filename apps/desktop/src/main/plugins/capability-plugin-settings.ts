// 校验清单声明的设置，普通值与每插件的系统加密密钥分别保存，表单只读到密钥的配置状态。
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import {
  type CapabilityPluginManifest,
  type CapabilityPluginSetting,
  type CapabilityPluginSettingsView,
} from "../../capability-plugin-contract"
import { capabilityPluginStoragePaths } from "./capability-plugin-paths"
import { atomicJson, readJson } from "./capability-plugin-records"
import type { CapabilityPluginSecrets } from "./capability-plugin-secrets"

type SettingValue = CapabilityPluginSettingsView["values"][string]

/** 主进程的声明式设置与密钥存储，管理器负责串行化表单修改和卸载。 */
export class CapabilityPluginSettings {
  /** 使用插件安装根和 Worker 共享的密钥仓库。 */
  constructor(
    private readonly root: string,
    private readonly secrets: CapabilityPluginSecrets,
  ) {}

  /** 回传清单声明的普通设置及已配置的密钥字段，不解密密钥。 */
  async read(manifest: CapabilityPluginManifest): Promise<CapabilityPluginSettingsView> {
    const secretFields = manifest.settings.filter((setting) => setting.type === "secret")
    const [stored, savedSecretKeys] = await Promise.all([
      this.#storedValues(manifest.id),
      secretFields.length === 0 ? [] : this.secrets.keys(manifest.id),
    ])
    const secretKeys = new Set(savedSecretKeys)
    const values = Object.fromEntries(
      manifest.settings.flatMap((field) => {
        if (field.type === "secret") return []
        const saved = Object.hasOwn(stored, field.key) ? stored[field.key] : undefined
        const value = accepts(field, saved) ? saved : field.defaultValue
        return value === undefined ? [] : [[field.key, value]]
      }),
    )
    return {
      values,
      configuredSecrets: secretFields
        .filter((field) => secretKeys.has(field.key))
        .map((field) => field.key),
    }
  }

  /** 保存一个声明字段。值为 null 时恢复普通默认值或清除密钥。 */
  async set(
    manifest: CapabilityPluginManifest,
    key: string,
    value: unknown,
  ): Promise<CapabilityPluginSettingsView> {
    const field = manifest.settings.find((setting) => setting.key === key)
    if (!field || (value !== null && !accepts(field, value)))
      throw new Error("PLUGIN_SETTING_INVALID")
    if (field.type === "secret") {
      await this.secrets.write(manifest.id, field.key, typeof value === "string" ? value : null)
    } else {
      const { dataDirectory } = capabilityPluginStoragePaths(this.root, manifest.id)
      const stored = await this.#storedValues(manifest.id)
      if (value === null) delete stored[key]
      else Object.defineProperty(stored, key, { value, enumerable: true, configurable: true })
      await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
      await atomicJson(join(dataDirectory, "settings.json"), stored)
    }
    return this.read(manifest)
  }

  async #storedValues(pluginId: string): Promise<Record<string, unknown>> {
    const { dataDirectory } = capabilityPluginStoragePaths(this.root, pluginId)
    const data = await readJson(join(dataDirectory, "settings.json"))
    if (data === undefined) return {}
    if (typeof data !== "object" || data === null || Array.isArray(data))
      throw new Error("PLUGIN_SETTING_INVALID")
    return { ...data }
  }
}

function accepts(field: CapabilityPluginSetting, value: unknown): value is SettingValue {
  switch (field.type) {
    case "text":
      return typeof value === "string" && value.length <= 4_096
    case "secret":
      return typeof value === "string" && value.length > 0 && value.length <= 4_096
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "boolean":
      return typeof value === "boolean"
    case "select":
      return field.options.some((option) => option.value === value)
  }
}
