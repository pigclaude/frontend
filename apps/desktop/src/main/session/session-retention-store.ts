// 负责保存本机自动删除会话的天数，未设置或损坏时默认由用户手动删除。

import { randomUUID } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isSessionRetentionDays, type SessionRetention } from "../../session-history-contract"
import { isPlainRecord } from "./session-store-guards"

/** 保存并读取应用自己的会话保留期，写入失败时保留之前设置。 */
export class SessionRetentionStore {
  readonly #file: string
  #writes = Promise.resolve()

  /** 绑定 Electron 的用户数据目录。 */
  constructor(userDataPath: string) {
    this.#file = join(userDataPath, "session-retention.json")
  }

  /** 读当前天数；还没有文件或内容无法解析时返回 null。 */
  async get(): Promise<SessionRetention> {
    await this.#writes
    try {
      const value: unknown = JSON.parse(await readFile(this.#file, "utf8"))
      if (isPlainRecord(value) && isSessionRetentionDays(value.days)) return { days: value.days }
    } catch {
      // 读取失败时维持默认保留行为。
    }
    return { days: null }
  }

  /** 同一时刻只写一份设置，原子替换使中断后仍可读。 */
  update(days: number | null): Promise<SessionRetention> {
    const result = this.#writes.then(async () => {
      const temporary = `${this.#file}.${randomUUID()}.tmp`
      const retention = { days }
      try {
        await writeFile(temporary, JSON.stringify(retention) + "\n", { mode: 0o600, flag: "wx" })
        await rename(temporary, this.#file)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
      return retention
    })
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
