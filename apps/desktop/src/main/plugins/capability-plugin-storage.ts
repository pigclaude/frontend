// 为能力插件原子读写一个专用 JSON 文件，按编码后的字节数限定总配额。

import { randomUUID } from "node:crypto"
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { z } from "zod"
import { containsProjectPath } from "../session/project-configuration-scope"
import { readBoundedPluginFile } from "./plugin-bounded-file"
import { PluginSandboxError, type PluginSandboxJson } from "./plugin-sandbox-contract"

const quota = 1024 * 1024
const entries = z.record(z.string(), z.json())

/** 调用方在安装管理器的同一队列操作此文件，保证多个会话的写入不会丢失。 */
export class CapabilityPluginStorage {
  /** 数据目录取自同一个已验证的插件安装快照。 */
  constructor(
    private readonly userDataPath: string,
    private readonly dataDirectory: string,
  ) {}

  /** 读取自己的一个值，缺少键时返回 null。 */
  async get(key: string): Promise<PluginSandboxJson> {
    const path = await this.#path()
    return (await read(path)).get(key) ?? null
  }

  /** 保存一个值或删除指定键，只在当前调用仍有效时替换数据文件。 */
  async change(
    key: string,
    value: PluginSandboxJson | undefined,
    assertCurrent: () => void,
  ): Promise<null> {
    const path = await this.#path()
    const current = await read(path)
    if (value === undefined) {
      if (!current.delete(key)) return null
    } else current.set(key, value)
    const text = JSON.stringify(Object.fromEntries(current))
    if (Buffer.byteLength(text) > quota) throw denied()
    assertCurrent()
    const directory = dirname(path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (relative(directory, await realpath(directory)) !== "") throw denied()
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, text, { flag: "wx", mode: 0o600 })
      assertCurrent()
      await rename(temporary, path)
      return null
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  async #path(): Promise<string> {
    if (!containsProjectPath(this.userDataPath, this.dataDirectory)) throw denied()
    const suffix = relative(this.userDataPath, this.dataDirectory)
    if (suffix === "") throw denied()
    return join(resolve(await realpath(this.userDataPath), suffix), "storage.json")
  }
}

async function read(path: string): Promise<Map<string, PluginSandboxJson>> {
  try {
    const bytes = await readBoundedPluginFile(path, quota, true)
    const record = entries.parse(JSON.parse(bytes.toString("utf8")) as unknown)
    return new Map(Object.entries(record))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return new Map()
    throw error
  }
}

function denied() {
  return new PluginSandboxError("PLUGIN_CAPABILITY_DENIED")
}
