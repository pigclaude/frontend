// 验证写进时间线前的脱敏：保存分类的穷举检查、64 KiB 截断与标记、截图占位和浏览器输入里的密码打码。

import { describe, expect, it } from "vitest"
import { sessionEventKinds } from "./session-envelope"
import { maskedSecret } from "./session-browser-secrets"
import { envelopeOf } from "./session-store-fixtures"
import {
  screenshotPlaceholder,
  timelineContentLimitBytes,
  timelineEnvelope,
} from "./session-timeline-redaction"
import type { SessionHostEvent } from "./session-types"

type EventSamples = { [K in SessionHostEvent["type"]]: Extract<SessionHostEvent, { type: K }> }

const samples: EventSamples = {
  started: {
    type: "started",
    sessionId: "s-1",
    model: "claude-sonnet-4-5",
    tools: ["Bash"],
    permissionMode: "default",
  },
  mode: { type: "mode", permissionMode: "plan" },
  delta: { type: "delta", text: "正在", thinking: false, blockIndex: 0 },
  message: {
    type: "message",
    messageId: "m-1",
    model: "claude-sonnet-4-5",
    parentToolUseId: null,
    blocks: [{ type: "text", text: "你好" }],
  },
  "tool-result": { type: "tool-result", toolUseId: "t-1", content: "ok", isError: false },
  permission: { type: "permission", requestId: "p-1", toolName: "Bash", input: { command: "ls" } },
  question: {
    type: "question",
    requestId: "q-1",
    questions: [
      {
        question: "用哪个分支？",
        header: "分支",
        options: [{ label: "main", description: "主分支" }],
        multiSelect: false,
      },
    ],
  },
  "question-resolved": { type: "question-resolved", requestId: "q-1", answers: ["main"] },
  "account-switched": { type: "account-switched", from: null, to: "account-1", reason: "initial" },
  notice: { type: "notice", message: "自动审批不可用" },
  result: {
    type: "result",
    subtype: "success",
    isError: false,
    durationMs: 1000,
    numTurns: 1,
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 },
  },
  "turn-started": { type: "turn-started", turnId: "turn-1" },
  "turn-ended": { type: "turn-ended", turnId: "turn-1", status: "completed", errorCode: null },
  error: { type: "error", code: "SDK_ERROR", message: "出错了" },
  ended: { type: "ended", reason: "completed" },
}

function messageWithTool(name: string, input: unknown): SessionHostEvent {
  return {
    type: "message",
    messageId: "m-2",
    model: "claude-sonnet-4-5",
    parentToolUseId: null,
    blocks: [{ type: "tool-use", id: "t-2", name, input }],
  }
}

function toolInputOf(event: SessionHostEvent | undefined): unknown {
  if (event?.type !== "message") throw new Error("not a message")
  const block = event.blocks[0]
  if (block?.type !== "tool-use") throw new Error("not a tool use")
  return block.input
}

const pngBase64 = `iVBORw0KGgoAAAANSUhEUgAA${"A".repeat(400)}`

describe("timelineEnvelope 保存分类", () => {
  it("sessionEventKinds 里每个要保存的类型都写进时间线，只用于实时的类型都不写", () => {
    for (const [type, kind] of Object.entries(sessionEventKinds)) {
      const event = samples[type as SessionHostEvent["type"]]
      const written = timelineEnvelope(envelopeOf("s-1", kind === "persisted" ? 7 : null, event))

      if (kind === "persisted") expect(written?.event, type).toEqual(event)
      else expect(written, type).toBeNull()
    }
  })

  it("不在时间线里留下截断标记，除非真的截断了", () => {
    const written = timelineEnvelope(envelopeOf("s-1", 1, samples.message))

    expect(written).not.toHaveProperty("truncated")
    expect(written).toMatchObject({ seq: 1, sessionId: "s-1" })
  })
})

describe("timelineEnvelope 截断", () => {
  it("超过 64 KiB 的文本按 UTF-8 字节截断，不切断多字节字符，并在信封里标出截断的位置和原长度", () => {
    const text = "中".repeat(30_000)
    const event: SessionHostEvent = { ...samples.message, blocks: [{ type: "text", text }] }

    const written = timelineEnvelope(envelopeOf("s-1", 3, event))

    const block = written?.event.type === "message" ? written.event.blocks[0] : undefined
    const kept = block?.type === "text" ? block.text : ""
    expect(Buffer.byteLength(kept, "utf8")).toBeLessThanOrEqual(timelineContentLimitBytes)
    expect(Buffer.byteLength(kept, "utf8")).toBeGreaterThan(timelineContentLimitBytes - 3)
    expect(text.startsWith(kept)).toBe(true)
    expect(kept).not.toContain("\uFFFD")
    expect(written?.truncated).toEqual([{ path: "event.blocks.0.text", bytes: 90_000 }])
  })

  it("工具结果和工具输入里的长字符串也截断", () => {
    const long = "a".repeat(timelineContentLimitBytes + 10)
    const result = timelineEnvelope(
      envelopeOf("s-1", 4, { ...samples["tool-result"], content: long }),
    )
    const tool = timelineEnvelope(envelopeOf("s-1", 5, messageWithTool("Write", { content: long })))

    expect(result?.truncated).toEqual([
      { path: "event.content", bytes: timelineContentLimitBytes + 10 },
    ])
    expect(tool?.truncated).toEqual([
      { path: "event.blocks.0.input.content", bytes: timelineContentLimitBytes + 10 },
    ])
  })
})

describe("timelineEnvelope 截图", () => {
  it("工具输入或结果里的图片数据只留占位", () => {
    const blocks = messageWithTool("mcp__browser__browser_screenshot", {
      content: [
        { type: "image", data: pngBase64, mimeType: "image/png" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
        { type: "text", text: "截图完成" },
      ],
      image: { data: pngBase64, mimeType: "image/png" },
      screenshot: pngBase64,
    })
    const result: SessionHostEvent = {
      ...samples["tool-result"],
      content: `截图：data:image/png;base64,${pngBase64} 完成`,
    }

    const input = toolInputOf(timelineEnvelope(envelopeOf("s-1", 6, blocks))?.event)
    const content = timelineEnvelope(envelopeOf("s-1", 7, result))?.event

    expect(input).toEqual({
      content: [
        { type: "image", omitted: true },
        { type: "image", omitted: true },
        { type: "text", text: "截图完成" },
      ],
      image: { type: "image", omitted: true },
      screenshot: screenshotPlaceholder,
    })
    expect(content).toMatchObject({ content: `截图：${screenshotPlaceholder} 完成` })
    expect(JSON.stringify([input, content])).not.toContain("iVBORw0KGgo")
  })

  it("工具结果里不带 data URL 前缀的 base64 截图同样只留占位", () => {
    const whole: SessionHostEvent = { ...samples["tool-result"], content: pngBase64 }
    const embedded: SessionHostEvent = {
      ...samples["tool-result"],
      content: `截图如下 ${pngBase64} 完成`,
    }

    const results = [whole, embedded].map(
      (event) => timelineEnvelope(envelopeOf("s-1", 13, event))?.event,
    )

    expect(results).toMatchObject([
      { content: screenshotPlaceholder },
      { content: `截图如下 ${screenshotPlaceholder} 完成` },
    ])
  })
})

describe("timelineEnvelope 密码打码", () => {
  it("浏览器输入工具写进密码框的内容换成固定占位，不留长度", () => {
    const cases: Array<Record<string, unknown>> = [
      { selector: "input[type=password]", text: "hunter2" },
      { ref: "e5", element: "密码输入框", text: "hunter2" },
      { ref: "e5", type: "password", text: "hunter2", submit: true },
      { ref: "e5", password: true, value: "hunter2" },
      { ref: "e5", password: "hunter2" },
    ]

    const masked = cases.map((input) =>
      toolInputOf(
        timelineEnvelope(envelopeOf("s-1", 8, messageWithTool("browser_type", input)))?.event,
      ),
    )

    expect(masked).toEqual([
      { selector: "input[type=password]", text: maskedSecret },
      { ref: "e5", element: "密码输入框", text: maskedSecret },
      { ref: "e5", type: "password", text: maskedSecret, submit: true },
      { ref: "e5", password: true, value: maskedSecret },
      { ref: "e5", password: maskedSecret },
    ])
  })

  it("表单填写里只给密码字段打码，权限请求里的浏览器输入同样打码", () => {
    const fields = {
      fields: [
        { name: "邮箱", type: "textbox", ref: "e3", value: "demo@example.com" },
        { name: "Password", type: "textbox", ref: "e4", value: "hunter2" },
      ],
    }
    const permission: SessionHostEvent = {
      type: "permission",
      requestId: "p-2",
      toolName: "mcp__pigclaude_workbench__browser_fill_form",
      input: fields,
    }

    const form = toolInputOf(
      timelineEnvelope(envelopeOf("s-1", 9, messageWithTool("browser_fill_form", fields)))?.event,
    )
    const request = timelineEnvelope(envelopeOf("s-1", 10, permission))?.event

    const expected = {
      fields: [
        { name: "邮箱", type: "textbox", ref: "e3", value: "demo@example.com" },
        { name: "Password", type: "textbox", ref: "e4", value: maskedSecret },
      ],
    }
    expect(form).toEqual(expected)
    expect(request).toMatchObject({ input: expected })
  })

  it("普通输入框和非浏览器工具不打码", () => {
    const typed = { ref: "e3", element: "搜索框", text: "pigclaude" }
    const bash = { command: "echo password=1" }

    expect(
      toolInputOf(
        timelineEnvelope(envelopeOf("s-1", 11, messageWithTool("browser_type", typed)))?.event,
      ),
    ).toEqual(typed)
    expect(
      toolInputOf(timelineEnvelope(envelopeOf("s-1", 12, messageWithTool("Bash", bash)))?.event),
    ).toEqual(bash)
  })
})
