// 原子读写本机列表，保留无法识别的条目，并为迁移保存原始备份。

import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

/** 有效记录与未解析的原始记录；写回不得丢弃后者。 */
export type StoredList<T> = { items: T[]; invalid: unknown[] }

/** 缺文件视为空列表，非列表文件明确报错。 */
export async function readStoredList<T>(
  path: string,
  parse: (value: unknown) => T | null,
): Promise<StoredList<T>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return { items: [], invalid: [] }
    throw error
  }
  if (!Array.isArray(parsed)) throw new Error(`${basename(path)} 不是列表`)
  const items: T[] = [],
    invalid: unknown[] = []
  for (const value of parsed) {
    const item = parse(value)
    if (item === null) invalid.push(value)
    else items.push(item)
  }
  return { items, invalid }
}

/** 同目录临时写入再替换，文件和目录只允许当前用户访问。 */
export async function writeStoredList<T>(path: string, stored: StoredList<T>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify([...stored.items, ...stored.invalid]), {
      encoding: "utf8",
      mode: 0o600,
    })
    await rename(temporary, path)
  } catch (error: unknown) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** 按稳定 id 替换或追加记录，保持其他记录顺序。 */
export function replaceStoredItem<T extends { id: string }>(items: readonly T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  return index < 0
    ? [...items, next]
    : items.map((item, itemIndex) => (itemIndex === index ? next : item))
}

/** 首次迁移复制原文件；已有备份不覆盖，失败则不继续迁移。 */
export async function backupLocalJson(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    await chmod(destination, 0o600)
  } catch (error: unknown) {
    if (errorCode(error) !== "EEXIST") throw error
  }
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : null
}
