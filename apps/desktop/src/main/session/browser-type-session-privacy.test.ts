// 用合成输入验证 SDK 事件和真实会话文件不会带上浏览器输入原文。
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, expect, it } from "vitest"
import { browserTypeToolName } from "../../browser-permission-contract"
import { normalizeSdkMessage } from "./claude-sdk-messages"
import { maskedSecret } from "./session-browser-secrets"
import { SessionStore } from "./session-store"
import {
  envelopeOf,
  newSessionIndex,
  removeTemporaryDirs,
  temporaryDir,
} from "./session-store-fixtures"
import type { SessionHostEvent } from "./session-types"

afterEach(removeTemporaryDirs)

const synthetic = "Synthetic input fixture ✨"

it("SDK 只有不透明 ref 时先遮掉输入，不让主线程和子代理的工具事件带原文", () => {
  for (const parent of [null, "parent-agent-tool"]) {
    const sdk = {
      type: "assistant",
      parent_tool_use_id: parent,
      message: {
        id: "assistant-fixture",
        model: "fixture",
        content: [
          {
            type: "tool_use",
            id: "type-fixture",
            name: browserTypeToolName,
            input: { ref: "e9", text: synthetic, clear: true },
          },
        ],
      },
    } as unknown as SDKMessage
    const events = normalizeSdkMessage(sdk)
    expect(events).toMatchObject([
      {
        type: "message",
        blocks: [
          { name: browserTypeToolName, input: { ref: "e9", text: maskedSecret, clear: true } },
        ],
      },
    ])
    expect(JSON.stringify(events)).not.toContain(synthetic)
  }
})

it("当前批准时可接收文字，写盘和读回都隐藏密码及长度", async () => {
  const root = join(await temporaryDir(), "session-store")
  const store = await SessionStore.open({ root })
  await store.create(newSessionIndex("s-1"))
  const event: SessionHostEvent = {
    type: "permission",
    toolName: browserTypeToolName,
    requestId: "input-permission-fixture",
    input: { ref: "e9", text: synthetic, clear: true, submit: false },
    browser: {
      kind: "type",
      url: "http://127.0.0.1:3200/",
      ref: "e9",
      role: "textbox",
      name: "合成密码字段",
      isPassword: true,
      characterCount: [...synthetic].length,
      clear: true,
      submit: false,
    },
    subagent: null,
  }
  expect(await store.appendTimeline("s-1", envelopeOf("s-1", 1, event))).toBe(true)
  expect(event.input.text).toBe(synthetic)
  const lines = await readFile(store.paths("s-1").timelineFile, "utf8")
  expect(lines).not.toContain(synthetic)
  expect(lines).not.toContain("characterCount")
  expect(lines).toContain(maskedSecret)
  const resumed = await SessionStore.open({ root })
  await expect(resumed.readTimeline("s-1")).resolves.toMatchObject({
    envelopes: [
      { event: { input: { ref: "e9", text: maskedSecret }, browser: { isPassword: true } } },
    ],
  })
})
