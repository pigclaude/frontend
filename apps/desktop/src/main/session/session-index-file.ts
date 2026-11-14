// 负责会话索引文件的读写：读出并解析，写入时先写同目录临时文件再改名，文件 0600。
// 写到一半失败时原文件不变，临时文件删掉。

import { randomUUID } from "node:crypto"
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { parseSessionIndex, type ParsedSessionIndex } from "./session-index"
import { indexTemporaryFile, sessionStoreFileMode } from "./session-store-layout"

/** 读索引文件的结果：没有文件、读不了的 JSON，或解析结果。 */
export type SessionIndexFileRead = { kind: "missing" } | ParsedSessionIndex

/** 读出索引文件；文件不存在返回 missing，JSON 解析不了返回 invalid，其他读错误照常抛出。 */
export async function readSessionIndexFile(path: string): Promise<SessionIndexFileRead> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return { kind: "missing" }
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { kind: "invalid", reason: "not JSON" }
  }
  return parseSessionIndex(value)
}

/** 原子写入索引文件：要么是完整的新内容，要么保持原文件；结束时不留临时文件。 */
export async function writeSessionIndexFile(
  path: string,
  record: Readonly<Record<string, unknown>>,
): Promise<void> {
  const temporary = indexTemporaryFile(dirname(path), randomUUID())
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      mode: sessionStoreFileMode,
      flag: "wx",
    })
    await chmod(temporary, sessionStoreFileMode)
    await rename(temporary, path)
  } catch (error: unknown) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** 取 Node 文件错误的 code；不是文件错误时返回 null。 */
export function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : null
}
