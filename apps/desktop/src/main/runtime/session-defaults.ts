// 负责读写 <userData>/session-defaults.json：新会话的默认模型、默认权限档位和选号偏好。
// 只存在本机；文件损坏或某一项不合法时，那一项按内置默认处理。

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
  builtinSessionDefaults,
  normalizeSessionDefaults,
  type SessionDefaults,
  type SessionDefaultsPatch,
} from "../../session-defaults-contract"

/** 默认设置文件。保证读出的每一项都合法；写入先写临时文件再改名。 */
export class SessionDefaultsStore {
  readonly #filePath: string
  #writes: Promise<unknown> = Promise.resolve()

  /** 创建绑定到固定文件的存储；文件路径由 main 用 userData 拼出，测试可用临时目录。 */
  constructor(options: { filePath: string }) {
    this.#filePath = options.filePath
  }

  /** 返回当前默认设置；没有文件或文件损坏时返回内置默认。 */
  async get(): Promise<SessionDefaults> {
    try {
      return normalizeSessionDefaults(JSON.parse(await readFile(this.#filePath, "utf8")))
    } catch {
      return { ...builtinSessionDefaults }
    }
  }

  /** 合并已校验的修改并保存，返回保存后的完整设置；同时到来的修改依次合并，不互相覆盖。 */
  update(patch: SessionDefaultsPatch): Promise<SessionDefaults> {
    const result = this.#writes.then(() => this.#write(patch))
    this.#writes = result.catch(() => undefined)
    return result
  }

  async #write(patch: SessionDefaultsPatch): Promise<SessionDefaults> {
    const next = { ...(await this.get()), ...patch }
    await mkdir(dirname(this.#filePath), { recursive: true, mode: 0o700 })
    const temporary = `${this.#filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 })
    await rename(temporary, this.#filePath)
    return next
  }
}
