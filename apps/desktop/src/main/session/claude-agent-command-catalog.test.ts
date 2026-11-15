// 验证 SDK 初始化命令和命令变更消息按会话交给宿主，迟到的旧读取不会覆盖新版完整列表。

import type { SDKMessage, SlashCommand } from "@anthropic-ai/claude-agent-sdk"
import { expect, it, vi } from "vitest"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { FakeQuery, startOptions } from "./claude-agent-adapter-fixtures"
import type { AdapterEvent } from "./session-events"

it("加载初始命令，并以 SDK 推送的完整列表替换它", async () => {
  const supportedCommands = vi.fn(async () => [command("compact", true)])
  const query = Object.assign(new FakeQuery(), { supportedCommands })
  const events: AdapterEvent[] = []
  const adapter = new ClaudeAgentAdapter({
    queryFn: () => query,
    resolveBinaryPath: () => "/synthetic/claude",
    onEvent: (event) => events.push(event),
  })
  try {
    await adapter.start(startOptions())
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: "commands-changed",
        commands: [{ name: "compact", text: "/compact", kind: "builtin" }],
      }),
    )
    query.emit({
      type: "system",
      subtype: "commands_changed",
      commands: [command("project:inspect"), command("login", true)],
      session_id: "test-session",
      uuid: "00000000-0000-4000-8000-000000000099",
    })
    await vi.waitFor(() =>
      expect(events.filter((event) => event.type === "commands-changed").at(-1)).toEqual({
        type: "commands-changed",
        commands: [{ name: "project:inspect", text: "/project:inspect", kind: "skill" }],
      }),
    )
  } finally {
    await adapter.stop()
  }
})

function command(name: string, builtin = false): SlashCommand {
  return { name, builtin, description: "", argumentHint: "" }
}

it("init 列表变化时使用新的名字，即使 SDK 方法仍返回旧元数据", async () => {
  const query = Object.assign(new FakeQuery(), {
    supportedCommands: async () => [command("previous"), command("context", true)],
  })
  const events: AdapterEvent[] = []
  const adapter = new ClaudeAgentAdapter({
    queryFn: () => query,
    resolveBinaryPath: () => "/synthetic/claude",
    onEvent: (event) => events.push(event),
  })
  try {
    await adapter.start(startOptions())
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: "commands-changed",
        commands: expect.arrayContaining([{ name: "previous", text: "/previous", kind: "skill" }]),
      }),
    )
    query.emit({
      type: "system",
      subtype: "init",
      session_id: "test-session",
      model: "sonnet",
      tools: [],
      permissionMode: "default",
      slash_commands: ["fresh"],
      skills: ["fresh"],
    } as unknown as SDKMessage)
    await vi.waitFor(() =>
      expect(events.filter((event) => event.type === "commands-changed").at(-1)).toEqual({
        type: "commands-changed",
        commands: [{ name: "fresh", text: "/fresh", kind: "skill" }],
      }),
    )
  } finally {
    await adapter.stop()
  }
})
