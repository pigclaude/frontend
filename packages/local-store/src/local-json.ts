// 原子读写本机列表，保留无法识别的条目，并为迁移保存原始备份。

import { createHash, randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { chmod, link, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
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
  const data = await readFile(source)
  const original = backupList(data)
  const existing = await readBackup(destination)
  if (existing && isDeepStrictEqual(backupList(existing), original)) return
  const target = existing
    ? `${destination}.${createHash("sha256").update(data).digest("hex")}.json`
    : destination
  const prior = target === destination ? undefined : await readBackup(target)
  if (prior) {
    if (!isDeepStrictEqual(backupList(prior), original))
      throw new Error("原始备份内容不一致，已停止迁移")
    return
  }
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, "wx", 0o600)
    try {
      await file.writeFile(data)
      await file.sync()
    } finally {
      await file.close()
    }
    if (!(await readFile(temporary)).equals(data)) throw new Error("原始备份写入不完整，已停止迁移")
    try {
      await link(temporary, target)
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error
      const concurrent = await readBackup(target)
      if (!concurrent || !isDeepStrictEqual(backupList(concurrent), original))
        throw new Error("原始备份发布冲突，已停止迁移")
    }
  } catch (error: unknown) {
    throw new Error("原始备份未确认，已停止迁移", { cause: error })
  } finally {
    await rm(temporary, { force: true })
  }
}

async function readBackup(path: string): Promise<Buffer | undefined> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("原始备份不是普通文件，已停止迁移")
    const data = await readFile(path)
    backupList(data)
    await chmod(path, 0o600)
    return data
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return undefined
    throw error
  }
}

function backupList(data: Buffer): unknown[] {
  try {
    const value: unknown = JSON.parse(data.toString("utf8"))
    if (Array.isArray(value)) return value
  } catch {
    /* 既有截断文件不允许充当恢复点。 */
  }
  throw new Error("原始备份不完整，已停止迁移")
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : null
}
