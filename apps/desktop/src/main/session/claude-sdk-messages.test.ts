// 验证 SDK 工具结果携带的 JPEG 如何归一化为会话事件。
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { describe, expect, it } from "vitest"
import { syntheticJpegBase64 } from "../../test-support/synthetic-jpeg"
import { normalizeSdkMessage } from "./claude-sdk-messages"

function imageResult(content: unknown): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      // SDK 消息类型描述 Anthropic 格式，夹具也回放 MCP 直接给出的图片块。
      content: [{ type: "tool_result", tool_use_id: "screenshot-call", content }],
    } as SDKUserMessage["message"],
    parent_tool_use_id: "agent-call",
    agent_id: "agent-1",
  }
}

const jpeg = { type: "image", mimeType: "image/jpeg", data: syntheticJpegBase64 } as const

describe("SDK screenshot results", () => {
  it.each([
    [
      "Anthropic",
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: syntheticJpegBase64 },
      },
    ],
    ["MCP", jpeg],
  ])(
    "keeps a %s JPEG together with its text, tool ID, and subagent attribution",
    (_name, image) => {
      expect(normalizeSdkMessage(imageResult([{ type: "text", text: "Captured" }, image]))).toEqual(
        [
          {
            type: "tool-result",
            toolUseId: "screenshot-call",
            content: "Captured",
            image: jpeg,
            isError: false,
            subagent: { parentToolUseId: "agent-call", agentId: "agent-1" },
          },
        ],
      )
    },
  )

  it("keeps the text when the accompanying image is outside the JPEG contract", () => {
    const unknownImage = { ...jpeg, mimeType: "image/png" }
    expect(
      normalizeSdkMessage(imageResult([{ type: "text", text: "Tool output" }, unknownImage])),
    ).toEqual([
      {
        type: "tool-result",
        toolUseId: "screenshot-call",
        content: "Tool output",
        isError: false,
        subagent: { parentToolUseId: "agent-call", agentId: "agent-1" },
      },
    ])
  })
})
