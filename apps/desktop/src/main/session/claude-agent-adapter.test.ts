// 负责验证 Claude Agent SDK 适配器的固定选项、消息映射、发送、中断、停止、模型查询和二进制解析。

import { describe, expect, it } from "vitest"
import type {
  CanUseTool,
  ModelInfo,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import { ClaudeAgentAdapter, type AdapterEvent } from "./claude-agent-adapter"
import {
  capture,
  collectPrompt,
  FakeQuery,
  startOptions,
  waitUntil,
  type CapturedQuery,
} from "./claude-agent-adapter-fixtures"

describe("ClaudeAgentAdapter", () => {
  it("starts the SDK with the fixed isolated options", async () => {
    const fake = new FakeQuery()
    const captured: CapturedQuery[] = []
    const events: AdapterEvent[] = []
    const canUseTool: CanUseTool = async () => ({ behavior: "allow" })
    const abortController = new AbortController()
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, captured),
      resolveBinaryPath: () => "/resolved/claude",
      onEvent: (event) => events.push(event),
    })

    await adapter.start({
      workspace: "/tmp/workspace",
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:47821" },
      permissionMode: "default",
      canUseTool,
      abortController,
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]?.options).toMatchObject({
      cwd: "/tmp/workspace",
      pathToClaudeCodeExecutable: "/resolved/claude",
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:47821" },
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      forwardSubagentText: true,
      permissionMode: "default",
    })
    expect(captured[0]?.options).not.toHaveProperty("agentProgressSummaries")
    expect(captured[0]?.options.canUseTool).toBe(canUseTool)
    expect(captured[0]?.options.abortController).toBe(abortController)
    expect(captured[0]?.options.allowDangerouslySkipPermissions).toBe(true)
    expect(events).toEqual([])
    await adapter.stop()
  })

  it("uses the explicit binary path before the resolver", async () => {
    const fake = new FakeQuery()
    const captured: CapturedQuery[] = []
    let resolved = 0
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, captured),
      resolveBinaryPath: () => {
        resolved += 1
        return "/resolved/claude"
      },
    })

    await adapter.start({
      workspace: "/tmp/workspace",
      env: {},
      permissionMode: "bypassPermissions",
      canUseTool: async () => ({ behavior: "allow" }),
      abortController: new AbortController(),
      binaryPath: "/explicit/claude",
    })

    expect(captured[0]?.options.pathToClaudeCodeExecutable).toBe("/explicit/claude")
    expect(captured[0]?.options.allowDangerouslySkipPermissions).toBe(true)
    expect(resolved).toBe(0)
    await adapter.stop()
  })

  it("broadcasts a typed error and ends when binary resolution fails", async () => {
    const events: AdapterEvent[] = []
    let queryFnCalls = 0
    const adapter = new ClaudeAgentAdapter({
      queryFn: (params) => {
        queryFnCalls += 1
        return capture(new FakeQuery(), [])(params)
      },
      resolveBinaryPath: () => {
        throw new Error("CLAUDE_RUNTIME_UNAVAILABLE: missing binary")
      },
      onEvent: (event) => events.push(event),
    })

    await expect(adapter.start(startOptions())).rejects.toThrow(/CLAUDE_RUNTIME_UNAVAILABLE/)
    expect(queryFnCalls).toBe(0)
    expect(events).toEqual([
      {
        type: "error",
        code: "SDK_ERROR",
        message: "CLAUDE_RUNTIME_UNAVAILABLE: missing binary",
      },
      { type: "ended", reason: "error" },
    ])
    await expect(adapter.send("after failure")).rejects.toThrow(/not active/i)
    await expect(adapter.start(startOptions())).rejects.toThrow(/SESSION_ALREADY_ACTIVE/)
    await adapter.stop()
  })

  it("does not poison a later start when stop is called first", async () => {
    const fake = new FakeQuery()
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, []),
      resolveBinaryPath: () => "/resolved/claude",
    })

    await adapter.stop()
    await adapter.start(startOptions())
    expect(fake.closes).toBe(0)
    await adapter.stop()
    expect(fake.closes).toBe(1)
  })

  it("closes the query and rejects sends after the stream ends", async () => {
    const fake = new FakeQuery()
    const events: AdapterEvent[] = []
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, []),
      resolveBinaryPath: () => "/resolved/claude",
      onEvent: (event) => events.push(event),
    })
    await adapter.start(startOptions())

    fake.end()
    await waitUntil(() => events.some((event) => event.type === "ended"))

    expect(events.at(-1)).toEqual({ type: "ended", reason: "completed" })
    expect(fake.closes).toBe(1)
    await expect(adapter.send("after end")).rejects.toThrow(/not active/i)
    await adapter.stop()
    expect(fake.closes).toBe(1)
    expect(events.filter((event) => event.type === "ended")).toHaveLength(1)
  })

  it("maps init, partial, assistant, tool result and result messages to session events", async () => {
    const fake = new FakeQuery()
    const events: AdapterEvent[] = []
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, []),
      resolveBinaryPath: () => "/resolved/claude",
      onEvent: (event) => events.push(event),
    })
    await adapter.start({
      workspace: "/tmp/workspace",
      env: {},
      permissionMode: "default",
      canUseTool: async () => ({ behavior: "allow" }),
      abortController: new AbortController(),
    })

    fake.emit(initMessage())
    fake.emit(streamDelta("Hel", 0))
    fake.emit(streamThinkingDelta("maybe ", 1))
    fake.emit(assistantMessage())
    fake.emit(toolResultMessage())
    fake.emit(successResult())
    fake.end()

    await waitUntil(() => events.some((event) => event.type === "ended"))

    expect(events).toEqual([
      {
        type: "started",
        sessionId: "sdk-session",
        model: "claude-sonnet-4",
        tools: ["Read", "Bash"],
        permissionMode: "default",
      },
      { type: "delta", text: "Hel", thinking: false, blockIndex: 0 },
      { type: "delta", text: "maybe ", thinking: true, blockIndex: 1 },
      {
        type: "message",
        messageId: "msg-1",
        model: "claude-sonnet-4",
        parentToolUseId: null,
        blocks: [
          { type: "text", text: "Reading the file" },
          { type: "thinking", text: "need the config" },
          { type: "tool-use", id: "tool-1", name: "Read", input: { file_path: "/tmp/a" } },
        ],
      },
      { type: "tool-result", toolUseId: "tool-1", content: "file body", isError: false },
      {
        type: "result",
        subtype: "success",
        isError: false,
        durationMs: 1_200,
        numTurns: 1,
        stopReason: "end_turn",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 3,
          cacheCreationTokens: 4,
        },
      },
      { type: "ended", reason: "completed" },
    ])
    await adapter.stop()
  })

  it("forwards send input to the prompt stream and closes the query once", async () => {
    const fake = new FakeQuery()
    const prompts: SDKUserMessage[] = []
    const events: AdapterEvent[] = []
    const adapter = new ClaudeAgentAdapter({
      queryFn: (params) => {
        void collectPrompt(params.prompt, prompts)
        return fake
      },
      resolveBinaryPath: () => "/resolved/claude",
      onEvent: (event) => events.push(event),
    })
    await adapter.start({
      workspace: "/tmp/workspace",
      env: {},
      permissionMode: "default",
      canUseTool: async () => ({ behavior: "allow" }),
      abortController: new AbortController(),
    })

    await adapter.send("hello")
    await waitUntil(() => prompts.length === 1)
    expect(prompts[0]).toMatchObject({
      type: "user",
      message: { role: "user", content: "hello" },
      parent_tool_use_id: null,
      session_id: "",
    })

    await adapter.stop()
    await adapter.stop()
    await adapter.interrupt()
    expect(fake.closes).toBe(1)
    expect(events.filter((event) => event.type === "ended")).toEqual([
      { type: "ended", reason: "stopped" },
    ])
    await expect(adapter.send("after stop")).rejects.toThrow(/not active/i)
  })

  it("shares one interrupt between concurrent callers", async () => {
    const fake = new FakeQuery()
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, []),
      resolveBinaryPath: () => "/resolved/claude",
    })
    await adapter.start({
      workspace: "/tmp/workspace",
      env: {},
      permissionMode: "default",
      canUseTool: async () => ({ behavior: "allow" }),
      abortController: new AbortController(),
    })

    await Promise.all([adapter.interrupt(), adapter.interrupt()])
    expect(fake.interrupts).toBe(1)
    await adapter.stop()
    await adapter.interrupt()
    expect(fake.interrupts).toBe(1)
  })

  it("emits an error and ends when the SDK stream fails", async () => {
    const fake = new FakeQuery()
    const events: AdapterEvent[] = []
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, []),
      resolveBinaryPath: () => "/resolved/claude",
      onEvent: (event) => events.push(event),
    })
    await adapter.start({
      workspace: "/tmp/workspace",
      env: {},
      permissionMode: "default",
      canUseTool: async () => ({ behavior: "allow" }),
      abortController: new AbortController(),
    })

    fake.fail(new Error("sdk blew up"))
    await waitUntil(() => events.some((event) => event.type === "ended"))

    expect(events).toEqual([
      { type: "error", code: "SDK_ERROR", message: "sdk blew up" },
      { type: "ended", reason: "error" },
    ])
    await adapter.stop()
  })

  it("times out a hanging model query, closes the query and rejects readably", async () => {
    const fake = new HangingModelsQuery()
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, []),
      resolveBinaryPath: () => "/resolved/claude",
      modelsTimeoutMs: 10,
    })

    await expect(adapter.models({ workspace: "/tmp/workspace" })).rejects.toThrow(
      /MODEL_QUERY_TIMEOUT/,
    )
    expect(fake.closes).toBe(1)
  })

  it("lets a single model query wait less than the adapter default", async () => {
    const fake = new HangingModelsQuery()
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, []),
      resolveBinaryPath: () => "/resolved/claude",
      modelsTimeoutMs: 60_000,
    })

    await expect(adapter.models({ workspace: "/tmp/workspace", timeoutMs: 10 })).rejects.toThrow(
      "MODEL_QUERY_TIMEOUT: 模型查询超时（10 毫秒）",
    )
  })

  it("closes a query that resolves after stop was requested", async () => {
    const fake = new FakeQuery()
    const gateControl = { release: (): void => undefined }
    const gate = new Promise<void>((resolve) => {
      gateControl.release = resolve
    })
    const adapter = new ClaudeAgentAdapter({
      queryFn: async () => {
        await gate
        return fake
      },
      resolveBinaryPath: () => "/resolved/claude",
    })

    const startPromise = adapter.start(startOptions())
    const stopPromise = adapter.stop()
    gateControl.release()

    await startPromise
    await stopPromise
    expect(fake.closes).toBe(1)
  })

  it("queries supported models with the isolated options and closes the query", async () => {
    const fake = new FakeQuery([
      {
        value: "claude-sonnet-4",
        displayName: "Claude Sonnet 4",
        description: "Balanced model",
      },
    ])
    const captured: CapturedQuery[] = []
    const events: AdapterEvent[] = []
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, captured),
      resolveBinaryPath: () => "/resolved/claude",
      onEvent: (event) => events.push(event),
    })

    const models = await adapter.models({
      workspace: "/tmp/workspace",
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:47821" },
      binaryPath: "/models/claude",
    })

    expect(models[0]).toEqual({
      id: "claude-sonnet-4",
      displayName: "Claude Sonnet 4",
      description: "Balanced model",
      isDefault: true,
      efforts: [],
    })
    // SDK 没给出规范模型时，目录会补上当前模型，选择器不会只剩一条。
    expect(models.some((model) => model.id === "claude-opus-5-5")).toBe(true)
    expect(captured[0]?.options).toMatchObject({
      cwd: "/tmp/workspace",
      pathToClaudeCodeExecutable: "/models/claude",
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:47821" },
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
    })
    expect(fake.closes).toBe(1)
    expect(events).toEqual([])
  })
})

class HangingModelsQuery extends FakeQuery {
  override supportedModels(): Promise<ModelInfo[]> {
    return new Promise<ModelInfo[]>(() => undefined)
  }
}

function initMessage(): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: "sdk-session",
    model: "claude-sonnet-4",
    tools: ["Read", "Bash"],
    permissionMode: "default",
  } as unknown as SDKMessage
}

function streamDelta(text: string, index: number): SDKMessage {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", index, delta: { type: "text_delta", text } },
    parent_tool_use_id: null,
    uuid: "00000000-0000-4000-8000-000000000001",
    session_id: "sdk-session",
  } as unknown as SDKMessage
}

function streamThinkingDelta(thinking: string, index: number): SDKMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index,
      delta: { type: "thinking_delta", thinking },
    },
    parent_tool_use_id: null,
    uuid: "00000000-0000-4000-8000-000000000002",
    session_id: "sdk-session",
  } as unknown as SDKMessage
}

function assistantMessage(): SDKMessage {
  return {
    type: "assistant",
    message: {
      id: "msg-1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4",
      content: [
        { type: "text", text: "Reading the file" },
        { type: "thinking", thinking: "need the config" },
        { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/a" } },
      ],
      stop_reason: null,
      usage: {},
    },
    parent_tool_use_id: null,
    uuid: "00000000-0000-4000-8000-000000000003",
    session_id: "sdk-session",
  } as unknown as SDKMessage
}

function toolResultMessage(): SDKMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tool-1", content: "file body", is_error: false },
      ],
    },
    parent_tool_use_id: null,
    session_id: "sdk-session",
  } as unknown as SDKMessage
}

function successResult(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1_200,
    is_error: false,
    num_turns: 1,
    result: "done",
    stop_reason: "end_turn",
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 4,
    },
    uuid: "00000000-0000-4000-8000-000000000004",
    session_id: "sdk-session",
  } as unknown as SDKMessage
}
