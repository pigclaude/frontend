// 负责验证 Claude Agent SDK 适配器的固定选项、消息映射、发送、中断、停止、模型查询和二进制解析。

import { describe, expect, it } from "vitest"
import type {
  CanUseTool,
  ModelInfo,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import {
  ClaudeAgentAdapter,
  type AdapterQuery,
  type QueryFn,
  type SessionEvent,
} from "./claude-agent-adapter"

describe("ClaudeAgentAdapter", () => {
  it("starts the SDK with the fixed isolated options", async () => {
    const fake = new FakeQuery()
    const captured: CapturedQuery[] = []
    const events: SessionEvent[] = []
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
      permissionMode: "default",
    })
    expect(captured[0]?.options.canUseTool).toBe(canUseTool)
    expect(captured[0]?.options.abortController).toBe(abortController)
    expect(captured[0]?.options.allowDangerouslySkipPermissions).toBeUndefined()
    expect(events).toEqual([])
    await adapter.stop()
  })

  it("uses the explicit binary path before the resolver and allows bypass only when requested", async () => {
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

  it("maps init, partial, assistant, tool result and result messages to session events", async () => {
    const fake = new FakeQuery()
    const events: SessionEvent[] = []
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
    const events: SessionEvent[] = []
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
    const events: SessionEvent[] = []
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

  it("queries supported models with the isolated options and closes the query", async () => {
    const fake = new FakeQuery([
      {
        value: "claude-sonnet-4",
        displayName: "Claude Sonnet 4",
        description: "Balanced model",
      },
    ])
    const captured: CapturedQuery[] = []
    const events: SessionEvent[] = []
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

    expect(models).toEqual([
      {
        id: "claude-sonnet-4",
        displayName: "Claude Sonnet 4",
        description: "Balanced model",
        isDefault: false,
      },
    ])
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

type CapturedQuery = {
  prompt: string | AsyncIterable<SDKUserMessage>
  options: Options
}

function capture(fake: FakeQuery, captured: CapturedQuery[]): QueryFn {
  return (params) => {
    captured.push(params)
    return fake
  }
}

class AsyncQueue<T> implements AsyncIterator<T> {
  #values: T[] = []
  #waiters: { resolve: (result: IteratorResult<T>) => void; reject: (error: Error) => void }[] = []
  #failure: Error | null = null
  #done = false

  push(value: T): void {
    if (this.#done) return
    const waiter = this.#waiters.shift()
    if (waiter === undefined) this.#values.push(value)
    else waiter.resolve({ done: false, value })
  }

  end(): void {
    if (this.#done) return
    this.#done = true
    for (const waiter of this.#waiters.splice(0)) waiter.resolve({ done: true, value: undefined })
  }

  fail(error: Error): void {
    if (this.#done) return
    this.#failure = error
    this.#done = true
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error)
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.#values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.#failure !== null) return Promise.reject(this.#failure)
    if (this.#done) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }))
  }
}

class FakeQuery implements AdapterQuery {
  readonly #messages = new AsyncQueue<SDKMessage>()
  readonly #models: ModelInfo[]
  interrupts = 0
  closes = 0

  constructor(models: ModelInfo[] = []) {
    this.#models = models
  }

  emit(message: SDKMessage): void {
    this.#messages.push(message)
  }

  end(): void {
    this.#messages.end()
  }

  fail(error: Error): void {
    this.#messages.fail(error)
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.#messages
  }

  async interrupt(): Promise<void> {
    this.interrupts += 1
  }

  close(): void {
    this.closes += 1
    this.#messages.end()
  }

  async supportedModels(): Promise<ModelInfo[]> {
    return this.#models
  }
}

async function collectPrompt(
  prompt: string | AsyncIterable<SDKUserMessage>,
  messages: SDKUserMessage[],
): Promise<void> {
  if (typeof prompt === "string") return
  for await (const message of prompt) messages.push(message)
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("condition was not reached")
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
