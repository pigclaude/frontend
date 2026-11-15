// 负责验证 session IPC 的边界校验：会话 id、补拉事件的参数、非法输入、未知字段、超大权限更新、
// 提问回答的条数和大小、不可信发送者和未装配服务。

import type { IpcMainInvokeEvent } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionHost } from "./session-host"
import {
  readPermissionAnswer,
  readPermissionMode,
  readQuestionAnswer,
  readSessionSendInput,
  readSessionStartInput,
  readUsageRange,
  registerSessionIpc,
  type SessionIpcOptions,
} from "./session-ipc"

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => unknown>(),
}))

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, value?: unknown) => unknown,
    ): void => {
      handlers.set(channel, handler)
    },
  },
}))

beforeEach(() => {
  handlers.clear()
})

function event(trusted = true): IpcMainInvokeEvent {
  return { trusted } as unknown as IpcMainInvokeEvent
}

function fakeHost(): SessionHost {
  return {
    start: vi.fn(async () => ({ sessionId: "session-1" })),
    send: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    respondPermission: vi.fn(async () => undefined),
    answerQuestion: vi.fn(() => undefined),
    setMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    historyEvents: vi.fn(async () => []),
    models: vi.fn(async () => []),
    status: vi.fn(() => null),
    ready: vi.fn(async () => undefined),
    list: vi.fn(() => []),
    history: {
      rename: vi.fn(async () => undefined),
      archive: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      setRetention: vi.fn(async () => ({ days: null })),
    },
  } as unknown as SessionHost
}

function register(overrides: Partial<SessionIpcOptions> = {}): { host: SessionHost } {
  const host = fakeHost()
  registerSessionIpc({
    getHost: () => host,
    getUsage: () => null,
    isTrusted: (value) => (value as unknown as { trusted: boolean }).trusted,
    ...overrides,
  })
  return { host }
}

function handler(channel: string): (event: IpcMainInvokeEvent, value?: unknown) => unknown {
  const registered = handlers.get(channel)
  if (registered === undefined) throw new Error(`handler not registered: ${channel}`)
  return registered
}

describe("session IPC registration", () => {
  it("validates history operations and only dispatches authorized requests", async () => {
    const { host } = register()
    const sessionId = "session-1"
    await expect(
      handler("pigclaude:session-rename")(event(), { sessionId, title: " " }),
    ).rejects.toThrow("INVALID_SESSION_INPUT")
    await expect(
      handler("pigclaude:session-delete")(event(), { sessionId: "../escape" }),
    ).rejects.toThrow("INVALID_SESSION_INPUT")
    await expect(handler("pigclaude:session-set-retention")(event(), { days: -1 })).rejects.toThrow(
      "INVALID_SESSION_INPUT",
    )
    await expect(handler("pigclaude:session-list")(event(), { archived: "true" })).rejects.toThrow(
      "INVALID_SESSION_INPUT",
    )
    await expect(handler("pigclaude:session-clear-history")(event(false))).rejects.toThrow()
    expect(host.history.clear).not.toHaveBeenCalled()

    await handler("pigclaude:session-list")(event(), { archived: true })
    await handler("pigclaude:session-rename")(event(), { sessionId, title: " 新标题 " })
    await handler("pigclaude:session-archive")(event(), { sessionId, archived: false })
    await handler("pigclaude:session-delete")(event(), { sessionId })
    await handler("pigclaude:session-set-retention")(event(), { days: null })
    expect(host.list).toHaveBeenCalledWith(true)
    expect(host.history.rename).toHaveBeenCalledWith(sessionId, "新标题")
    expect(host.history.archive).toHaveBeenCalledWith(sessionId, false)
    expect(host.history.delete).toHaveBeenCalledWith(sessionId)
    expect(host.history.setRetention).toHaveBeenCalledWith(null)
  })
  it("passes validated input to the host", async () => {
    const { host } = register()

    await handler("pigclaude:session-start")(event(), {
      workspace: "/Users/me/app",
      permissionMode: "plan",
      thinking: "low",
      model: "claude-opus",
      accountId: "account-1",
    })

    expect(host.start).toHaveBeenCalledWith({
      workspace: "/Users/me/app",
      permissionMode: "plan",
      thinking: "low",
      model: "claude-opus",
      accountId: "account-1",
    })
  })

  it("passes the named session with every session command", async () => {
    const { host } = register()
    const target = { sessionId: "session-1" }

    await handler("pigclaude:session-send")(event(), { ...target, text: "hello" })
    await handler("pigclaude:session-cancel")(event(), target)
    await handler("pigclaude:session-respond-permission")(event(), {
      ...target,
      requestId: "permission-1",
      decision: "deny",
    })
    await handler("pigclaude:session-answer-question")(event(), {
      ...target,
      requestId: "question-1",
      answers: ["Blue", "macOS, Linux"],
    })
    await handler("pigclaude:session-set-mode")(event(), { ...target, mode: "plan" })
    await handler("pigclaude:session-set-model")(event(), { ...target, model: "claude-opus" })
    await handler("pigclaude:session-stop")(event(), target)
    await handler("pigclaude:session-events")(event(), { ...target, afterSeq: 3 })

    expect(host.send).toHaveBeenCalledWith("session-1", { text: "hello" }, expect.any(Function))
    expect(host.cancel).toHaveBeenCalledWith("session-1")
    expect(host.respondPermission).toHaveBeenCalledWith("session-1", {
      requestId: "permission-1",
      decision: "deny",
    })
    expect(host.answerQuestion).toHaveBeenCalledWith("session-1", {
      requestId: "question-1",
      answers: ["Blue", "macOS, Linux"],
    })
    expect(host.setMode).toHaveBeenCalledWith("session-1", "plan")
    expect(host.setModel).toHaveBeenCalledWith("session-1", "claude-opus")
    expect(host.stop).toHaveBeenCalledWith("session-1")
    expect(host.historyEvents).toHaveBeenCalledWith("session-1", 3)
  })

  it("only accepts structured conversation references from the trusted sender", async () => {
    const { host } = register()
    const send = handler("pigclaude:session-send")
    const reference = { kind: "thread", threadId: "session-2", title: "排查记录" }
    const input = { sessionId: "session-1", text: "参考 @排查记录" }

    await expect(send(event(false), { ...input, references: [reference] })).rejects.toThrow(
      "UNTRUSTED_SESSION_REQUEST",
    )
    for (const references of [
      null,
      [{}],
      [{ ...reference, kind: "file" }],
      [{ ...reference, title: 2 }],
    ]) {
      await expect(send(event(), { ...input, references })).rejects.toThrow("INVALID_SESSION_INPUT")
    }
    expect(host.send).not.toHaveBeenCalled()

    await send(event(), { ...input, references: [{ ...reference, path: "/ignored" }] })
    expect(host.send).toHaveBeenCalledWith(
      "session-1",
      { text: "参考 @排查记录", references: [reference] },
      expect.any(Function),
    )
  })

  it("rejects session commands without a usable session id", async () => {
    const { host } = register()

    for (const value of [undefined, {}, { sessionId: "" }, { sessionId: "x".repeat(201) }]) {
      await expect(handler("pigclaude:session-stop")(event(), value)).rejects.toThrow(
        "INVALID_SESSION_INPUT",
      )
    }
    await expect(handler("pigclaude:session-send")(event(), { text: "hello" })).rejects.toThrow(
      "INVALID_SESSION_INPUT",
    )
    expect(host.stop).not.toHaveBeenCalled()
    expect(host.send).not.toHaveBeenCalled()
  })

  it("checks the sender and the seq before reading missed events", async () => {
    const { host } = register()
    const read = handler("pigclaude:session-events")

    await expect(read(event(false), { sessionId: "session-1", afterSeq: 0 })).rejects.toThrow(
      "UNTRUSTED_SESSION_REQUEST",
    )
    for (const afterSeq of [-1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(read(event(), { sessionId: "session-1", afterSeq })).rejects.toThrow(
        "INVALID_SESSION_INPUT",
      )
    }
    expect(host.historyEvents).not.toHaveBeenCalled()
  })

  it("checks the sender and the answers before answering a question", async () => {
    const { host } = register()
    const answer = handler("pigclaude:session-answer-question")
    const target = { sessionId: "session-1", requestId: "question-1" }

    await expect(answer(event(false), { ...target, answers: ["Blue"] })).rejects.toThrow(
      "UNTRUSTED_SESSION_REQUEST",
    )
    await expect(answer(event(), { requestId: "question-1", answers: ["Blue"] })).rejects.toThrow(
      "INVALID_SESSION_INPUT",
    )
    expect(host.answerQuestion).not.toHaveBeenCalled()
  })

  it("rejects an untrusted sender before calling the host", async () => {
    const { host } = register()

    await expect(
      handler("pigclaude:session-send")(event(false), { text: "hello" }),
    ).rejects.toThrow("UNTRUSTED_SESSION_REQUEST")
    expect(host.send).not.toHaveBeenCalled()
  })

  it("reports a missing host and missing usage recorder as session errors", async () => {
    register({ getHost: () => null })

    await expect(handler("pigclaude:session-status")(event())).rejects.toThrow(/会话服务尚未准备好/)
    await expect(handler("pigclaude:usage-summary")(event(), { range: "today" })).rejects.toThrow(
      /用量记录尚未准备好/,
    )
  })
})

describe("readSessionStartInput", () => {
  it("rejects invalid workspace, mode, thinking and empty optional strings", () => {
    expect(() => readSessionStartInput(null)).toThrow("INVALID_SESSION_INPUT")
    expect(() => readSessionStartInput({ workspace: "", permissionMode: "default" })).toThrow(
      "INVALID_SESSION_INPUT",
    )
    expect(() =>
      readSessionStartInput({ workspace: "/Users/me/app", permissionMode: "dontAsk" }),
    ).toThrow("INVALID_SESSION_INPUT")
    expect(() =>
      readSessionStartInput({
        workspace: "/Users/me/app",
        permissionMode: "default",
        thinking: "extreme",
      }),
    ).toThrow("INVALID_SESSION_INPUT")
  })

  it("drops unknown fields and keeps omitted optionals absent", () => {
    const input = readSessionStartInput({
      workspace: "/Users/me/app",
      permissionMode: "default",
      model: "",
      accountId: 42,
      unexpected: "ignored",
    })

    expect(input).toEqual({ workspace: "/Users/me/app", permissionMode: "default" })
  })

  it("accepts SDK effort and fast mode and rejects invalid values", () => {
    expect(
      readSessionStartInput({
        workspace: "/Users/me/app",
        permissionMode: "default",
        effort: "xhigh",
        fast: true,
      }),
    ).toEqual({
      workspace: "/Users/me/app",
      permissionMode: "default",
      effort: "xhigh",
      fast: true,
    })
    expect(() =>
      readSessionStartInput({
        workspace: "/Users/me/app",
        permissionMode: "default",
        effort: "none",
      }),
    ).toThrow("INVALID_SESSION_INPUT")
    expect(() =>
      readSessionStartInput({
        workspace: "/Users/me/app",
        permissionMode: "default",
        fast: "yes",
      }),
    ).toThrow("INVALID_SESSION_INPUT")
  })
})

describe("readSessionSendInput", () => {
  it("preserves explicit settings, including standard speed and model default effort", () => {
    expect(readSessionSendInput({ text: "hello", effort: "max", fast: true })).toEqual({
      text: "hello",
      effort: "max",
      fast: true,
    })
    expect(readSessionSendInput({ text: "hello", effort: null, fast: false })).toEqual({
      text: "hello",
      effort: null,
      fast: false,
    })
    expect(() => readSessionSendInput({ text: "hello", effort: "none" })).toThrow(
      "INVALID_SESSION_INPUT",
    )
    expect(() => readSessionSendInput({ text: "hello", fast: "yes" })).toThrow(
      "INVALID_SESSION_INPUT",
    )
  })

  it("accepts text with and without attachments and rejects invalid shapes", () => {
    expect(readSessionSendInput({ text: "hello" })).toEqual({ text: "hello" })
    expect(readSessionSendInput({ text: "hello", attachments: ["a.ts"] })).toEqual({
      text: "hello",
      attachments: ["a.ts"],
    })
    expect(() => readSessionSendInput({ text: "" })).toThrow("INVALID_SESSION_INPUT")
    expect(() => readSessionSendInput({ text: "hi", attachments: [1] })).toThrow(
      "INVALID_SESSION_INPUT",
    )
    expect(() => readSessionSendInput({ text: "hi", attachments: "a.ts" })).toThrow(
      "INVALID_SESSION_INPUT",
    )
  })
})

describe("readPermissionAnswer", () => {
  it("accepts a suggestion index and scope without copying extra fields", () => {
    expect(
      readPermissionAnswer({
        requestId: "permission-1",
        decision: "allow",
        suggestion: { index: 1, scope: "project", rule: "Bash(*)" },
      }),
    ).toEqual({
      requestId: "permission-1",
      decision: "allow",
      suggestion: { index: 1, scope: "project" },
    })
  })

  it("rejects direct rule submission and malformed selections", () => {
    for (const answer of [
      { decision: "allow", updatedPermissions: [{ type: "addRules" }] },
      { decision: "allow", suggestion: { index: -1, scope: "session" } },
      { decision: "allow", suggestion: { index: 0.5, scope: "session" } },
      { decision: "allow", suggestion: { index: 0, scope: "userSettings" } },
      { decision: "deny", suggestion: { index: 0, scope: "session" } },
      { decision: "maybe" },
    ]) {
      expect(() => readPermissionAnswer({ requestId: "permission-1", ...answer })).toThrow(
        "INVALID_SESSION_INPUT",
      )
    }
  })
})

describe("readQuestionAnswer", () => {
  it("keeps one string per question and drops unknown fields", () => {
    expect(
      readQuestionAnswer({ requestId: "question-1", answers: ["Blue", ""], extra: true }),
    ).toEqual({ requestId: "question-1", answers: ["Blue", ""] })
  })

  it("rejects a missing request id and answers that are not a short list of strings", () => {
    for (const value of [
      null,
      { answers: ["Blue"] },
      { requestId: "x".repeat(201), answers: ["Blue"] },
      { requestId: "question-1" },
      { requestId: "question-1", answers: "Blue" },
      { requestId: "question-1", answers: [] },
      { requestId: "question-1", answers: ["Blue", 2] },
      { requestId: "question-1", answers: Array.from({ length: 17 }, () => "Blue") },
    ]) {
      expect(() => readQuestionAnswer(value)).toThrow("INVALID_SESSION_INPUT")
    }
  })

  it("rejects an oversized answer", () => {
    expect(
      readQuestionAnswer({ requestId: "q", answers: ["x".repeat(8 * 1024)] }).answers,
    ).toHaveLength(1)
    expect(() =>
      readQuestionAnswer({ requestId: "q", answers: ["x".repeat(8 * 1024 + 1)] }),
    ).toThrow("INVALID_SESSION_INPUT")
  })
})

describe("readPermissionMode and readUsageRange", () => {
  it("accepts only the four levels, plan and two ranges", () => {
    expect(readPermissionMode("bypassPermissions")).toBe("bypassPermissions")
    expect(readPermissionMode("auto")).toBe("auto")
    expect(() => readPermissionMode("dontAsk")).toThrow("INVALID_SESSION_INPUT")
    expect(readUsageRange({ range: "7d" })).toBe("7d")
    expect(() => readUsageRange({ range: "30d" })).toThrow("INVALID_SESSION_INPUT")
    expect(() => readUsageRange(null)).toThrow("INVALID_SESSION_INPUT")
  })
})
