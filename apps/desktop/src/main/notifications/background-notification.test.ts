// 验证台前窗口和通知正文的边界，避免把会话内容发送给系统通知中心。

import { expect, it } from "vitest"
import { backgroundNoticeFromSession, formatBackgroundNotice } from "./background-notification"
import type { SessionEnvelope } from "../session/session-envelope"

it("审批通知仅显示项目、用户命名的会话、事件和工具名", () => {
  const envelope: SessionEnvelope = {
    version: 1,
    sessionId: "session-a",
    seq: 9,
    at: "2026-11-15T00:00:00Z",
    event: {
      type: "permission",
      requestId: "request-internal",
      toolName: "Bash",
      input: { command: "private-tool-input" },
      blockedPath: "/private/tool-path",
      subagent: null,
    },
  }
  const notice = backgroundNoticeFromSession(envelope)
  expect(
    notice &&
      formatBackgroundNotice(notice, {
        projectPath: "/Users/example/workspace/project",
        projectName: "发布工具",
        title: "构建审查",
        titleSource: "user",
      }),
  ).toEqual({ title: "PigClaude", body: "需要审批 · 发布工具 · 构建审查 · Bash" })
})
