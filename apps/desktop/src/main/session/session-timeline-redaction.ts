// 负责把会话信封变成可以写进时间线的样子：只留要保存的事件，单条大内容截断到 64 KiB 并在信封里标记，
// 图片和截图数据只留占位，浏览器输入里的密码换成固定占位。脱敏规则按事件类型穷举。

import { maskBrowserSecrets } from "./session-browser-secrets"
import { sessionEventKinds, type SessionEnvelope } from "./session-envelope"
import type { SessionContentBlock } from "./session-events"
import { isPlainRecord } from "./session-store-guards"
import type { SessionHostEvent } from "./session-types"

/** 单个字符串在时间线里最多保留的 UTF-8 字节数。 */
export const timelineContentLimitBytes = 64 * 1024

/** 截图和图片数据在字符串里的占位。 */
export const screenshotPlaceholder = "[截图未保存]"

/** 一处截断：path 是信封里被截断字段的路径（例如 event.blocks.0.text），bytes 是原文的 UTF-8 字节数。 */
export type TimelineTruncation = { path: string; bytes: number }

/** 时间线里的一行：会话信封，加上截断过时才有的截断标记。 */
export type TimelineEnvelope = SessionEnvelope & { truncated?: TimelineTruncation[] }

type Marks = TimelineTruncation[]
type EventOf<K extends SessionHostEvent["type"]> = Extract<SessionHostEvent, { type: K }>
type TimelineRule<E> = ((event: E, marks: Marks) => E) | "live"

/** 每种事件类型的脱敏规则；表是穷举的，新事件类型不写规则过不了类型检查。"live" 表示不写进时间线。 */
const timelineRules: { [K in SessionHostEvent["type"]]: TimelineRule<EventOf<K>> } = {
  started: (event) => event,
  mode: (event) => event,
  delta: "live",
  "commands-changed": "live",
  message: (event, marks) => ({
    ...event,
    blocks: event.blocks.map((block, index) => redactBlock(block, `event.blocks.${index}`, marks)),
  }),
  "tool-result": ({ image, ...event }, marks) => {
    const limit = image
      ? timelineContentLimitBytes - Buffer.byteLength("\n" + screenshotPlaceholder)
      : timelineContentLimitBytes
    const text = redactString(event.content, "event.content", marks, limit)
    const content =
      image && text !== screenshotPlaceholder
        ? [text, screenshotPlaceholder].filter(Boolean).join("\n")
        : text
    return { ...event, content }
  },
  permission: (event, marks) => ({
    ...event,
    input: redactToolInput(event.toolName, event.input, "event.input", marks),
    ...(event.suggestions === undefined
      ? {}
      : { suggestions: redactUnknown(event.suggestions, "event.suggestions", marks) }),
  }),
  question: (event, marks) => ({
    ...event,
    questions: event.questions.map((question, index) => {
      const path = `event.questions.${index}`
      return {
        ...question,
        question: redactString(question.question, `${path}.question`, marks),
        options: question.options.map((option, at) => ({
          ...option,
          label: redactString(option.label, `${path}.options.${at}.label`, marks),
        })),
      }
    }),
  }),
  "question-resolved": (event, marks) => ({
    ...event,
    answers: event.answers.map((answer, index) =>
      redactString(answer, `event.answers.${index}`, marks),
    ),
  }),
  "account-switched": (event) => event,
  "sessions-changed": "live",
  notice: (event, marks) =>
    "message" in event
      ? { ...event, message: redactString(event.message, "event.message", marks) }
      : { ...event, params: redactUnknown(event.params, "event.params", marks) },
  context: (event) => event,
  result: (event) => event,
  "turn-started": (event, marks) => ({
    ...event,
    ...(typeof event.userText === "string"
      ? { userText: redactString(event.userText, "event.userText", marks) }
      : {}),
    ...(event.references === undefined
      ? {}
      : {
          references: event.references.map((reference, index) => ({
            ...reference,
            title: redactString(reference.title, `event.references.${index}.title`, marks),
          })),
        }),
  }),
  "turn-ended": (event) => event,
  "subagent-ended": (event, marks) => ({
    ...event,
    summary: redactString(event.summary, "event.summary", marks),
  }),
  workflow: (event, marks) => ({
    ...event,
    workflow: redactUnknown(event.workflow, "event.workflow", marks),
  }),
  error: (event, marks) => ({
    ...event,
    message: redactString(event.message, "event.message", marks),
  }),
  ended: (event) => event,
}

/**
 * 要写进时间线的信封：只用于实时的事件返回 null；其余按事件类型脱敏，截断过就带上截断标记。
 * 不修改传入的信封。
 */
export function timelineEnvelope(envelope: SessionEnvelope): TimelineEnvelope | null {
  const rule = timelineRules[envelope.event.type] as TimelineRule<SessionHostEvent>
  if (sessionEventKinds[envelope.event.type] === "live") return null
  if (rule === "live") throw new Error(`no timeline rule for ${envelope.event.type}`)
  const marks: Marks = []
  const event = rule(envelope.event, marks)
  return marks.length === 0 ? { ...envelope, event } : { ...envelope, event, truncated: marks }
}

function redactBlock(block: SessionContentBlock, path: string, marks: Marks): SessionContentBlock {
  if (block.type === "tool-use")
    return { ...block, input: redactToolInput(block.name, block.input, `${path}.input`, marks) }
  return { ...block, text: redactString(block.text, `${path}.text`, marks) }
}

function redactToolInput<T>(toolName: string, input: T, path: string, marks: Marks): T {
  return redactUnknown(maskBrowserSecrets(toolName, input), path, marks)
}

/** 只缩短字符串、把图片对象换成占位，不改其他结构，所以保留调用方的类型。 */
function redactUnknown<T>(value: T, path: string, marks: Marks): T {
  return redactValue(value, path, "", marks) as T
}

function redactValue(value: unknown, path: string, key: string, marks: Marks): unknown {
  if (typeof value === "string") {
    if (imageKeys.has(key.toLowerCase())) return screenshotPlaceholder
    return redactString(value, path, marks)
  }
  if (Array.isArray(value))
    return value.map((item, index) => redactValue(item, `${path}.${index}`, "", marks))
  if (!isPlainRecord(value)) return value
  if (isImageObject(value)) return { type: "image", omitted: true }
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [
      name,
      redactValue(item, `${path}.${name}`, name, marks),
    ]),
  )
}

const imageKeys = new Set(["screenshot", "imagedata", "image_data", "base64image"])
const dataUrlPattern = /data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g
const base64ImagePrefixes = ["iVBORw0KGgo", "/9j/", "R0lGOD", "UklGR"]
const base64ImagePattern = /(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)[A-Za-z0-9+/=]{48,}/g

/** 整个字符串是一张 base64 图片；允许 MIME 式的换行。 */
function isBase64Image(value: string): boolean {
  return (
    value.length >= 64 &&
    base64ImagePrefixes.some((prefix) => value.startsWith(prefix)) &&
    /^[A-Za-z0-9+/=\s]+$/.test(value)
  )
}

function isImageObject(value: Record<string, unknown>): boolean {
  if (value.type === "image") return true
  const mime = value.mimeType ?? value.mime_type ?? value.media_type
  return typeof value.data === "string" && typeof mime === "string" && mime.startsWith("image/")
}

function redactString(
  value: string,
  path: string,
  marks: Marks,
  limit = timelineContentLimitBytes,
): string {
  if (isBase64Image(value)) return screenshotPlaceholder
  const text = value
    .replace(dataUrlPattern, screenshotPlaceholder)
    .replace(base64ImagePattern, screenshotPlaceholder)
  const bytes = Buffer.byteLength(text, "utf8")
  if (bytes <= limit) return text
  marks.push({ path, bytes })
  return truncateUtf8(text, limit)
}

function truncateUtf8(text: string, limit: number): string {
  const encoded = Buffer.from(text, "utf8")
  let end = limit
  while (end > 0 && ((encoded[end] ?? 0) & 0xc0) === 0x80) end -= 1
  return encoded.subarray(0, end).toString("utf8")
}
