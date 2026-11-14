// 负责时间线文件的读写：每行一个信封，追加写；进程崩溃可能留下不完整的末行，
// 读回时跳过它，追加前把它截掉。中间解析不了的行跳过并计数。

import { appendFile, chmod, open, readFile, stat, truncate } from "node:fs/promises"
import { sessionEnvelopeVersion } from "./session-envelope"
import { fileErrorCode, isPlainRecord } from "./session-store-guards"
import { sessionStoreFileMode } from "./session-store-layout"
import type { TimelineEnvelope, TimelineTruncation } from "./session-timeline-redaction"

/** 读回的时间线：按文件顺序的信封、跳过的中间行数，以及末行是否不完整。 */
export type TimelineFileRead = {
  envelopes: TimelineEnvelope[]
  skippedLines: number
  incompleteTail: boolean
}

/** 读出时间线；文件不存在时为空。没有换行结尾的末行视为不完整，跳过。 */
export async function readTimelineFile(path: string): Promise<TimelineFileRead> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error: unknown) {
    if (fileErrorCode(error) === "ENOENT")
      return { envelopes: [], skippedLines: 0, incompleteTail: false }
    throw error
  }
  const lines = text.split("\n")
  const tail = lines.pop() ?? ""
  const envelopes: TimelineEnvelope[] = []
  let skippedLines = 0
  for (const line of lines) {
    const envelope = parseLine(line)
    if (envelope) envelopes.push(envelope)
    else skippedLines += 1
  }
  return { envelopes, skippedLines, incompleteTail: tail.length > 0 }
}

/** 截掉不完整的末行，保证之后追加的行不会接在半行后面；文件不存在或以换行结尾时不动。 */
export async function repairTimelineTail(path: string): Promise<void> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch (error: unknown) {
    if (fileErrorCode(error) === "ENOENT") return
    throw error
  }
  if (size === 0 || (await lastByte(path, size)) === 0x0a) return
  const data = await readFile(path)
  await truncate(path, data.lastIndexOf(0x0a) + 1)
}

/** 追加若干行信封，文件 0600。 */
export async function appendTimelineFile(
  path: string,
  envelopes: readonly TimelineEnvelope[],
): Promise<void> {
  if (envelopes.length === 0) return
  const text = envelopes.map((envelope) => `${JSON.stringify(envelope)}\n`).join("")
  await appendFile(path, text, { encoding: "utf8", mode: sessionStoreFileMode })
  await chmod(path, sessionStoreFileMode)
}

async function lastByte(path: string, size: number): Promise<number | undefined> {
  const file = await open(path, "r")
  try {
    const buffer = Buffer.alloc(1)
    await file.read(buffer, 0, 1, size - 1)
    return buffer[0]
  } finally {
    await file.close()
  }
}

function parseLine(line: string): TimelineEnvelope | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (
    !isPlainRecord(value) ||
    value.version !== sessionEnvelopeVersion ||
    typeof value.sessionId !== "string" ||
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 1 ||
    typeof value.at !== "string" ||
    !isPlainRecord(value.event) ||
    typeof value.event.type !== "string"
  )
    return null
  const { truncated, ...envelope } = value
  const marks = Array.isArray(truncated) ? truncated.filter(isTimelineTruncation) : []
  return { ...envelope, ...(marks.length === 0 ? {} : { truncated: marks }) } as TimelineEnvelope
}

function isTimelineTruncation(value: unknown): value is TimelineTruncation {
  return (
    isPlainRecord(value) &&
    typeof value.path === "string" &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0
  )
}
