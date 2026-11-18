// 三平台统一将第一方设备 OAuth 会话写入用户数据目录，用于重启时恢复。
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { writePrivateFile } from "../private-file"
import type { SecretVault } from "../secret-vault"

const sessionKey = "membership:session"

/** 设备 OAuth 只读写自己的会话文件，写入顺序由令牌管理器保证。 */
export class OAuthSessionFile implements SecretVault {
  readonly #path: string

  /** 绑定当前用户配置目录下的 OAuth 文件。 */
  constructor(userData: string) {
    this.#path = join(userData, "oauth-session.json")
  }

  /** 只返回当前设备会话材料，缺文件时视为未授权。 */
  async get(key: string): Promise<string | null> {
    if (key !== sessionKey) return null
    try {
      return await readFile(this.#path, "utf8")
    } catch (error: unknown) {
      if (typeof error === "object" && error && "code" in error && error.code === "ENOENT")
        return null
      throw error
    }
  }

  /** 原子落盘已由 OAuth 管理器验证过的会话记录。 */
  async set(key: string, value: string): Promise<void> {
    if (key !== sessionKey) throw new Error("INVALID_OAUTH_SESSION_KEY")
    await writePrivateFile(this.#path, value)
  }

  /** 退出或消费刷新令牌时，清除当前会话的磁盘恢复入口。 */
  async delete(key: string): Promise<void> {
    if (key === sessionKey) await rm(this.#path, { force: true })
  }
}
