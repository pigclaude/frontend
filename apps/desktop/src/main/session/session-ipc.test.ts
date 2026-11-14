// 负责验证 session IPC 的边界校验：非法输入、未知字段、超大权限更新、不可信发送者和未装配服务。

import type { IpcMainInvokeEvent } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionHost } from "./session-host"
import {
  readPermissionAnswer,
  readPermissionMode,
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
    setMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    models: vi.fn(async () => []),
    status: vi.fn(() => null),
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
  it("validates the decision and keeps valid updates", () => {
    expect(
      readPermissionAnswer({
        requestId: "permission-1",
        decision: "allow",
        updatedPermissions: [
          { type: "addRules", rules: [], behavior: "allow", destination: "session" },
        ],
      }),
    ).toMatchObject({ requestId: "permission-1", decision: "allow" })
    expect(() => readPermissionAnswer({ requestId: "permission-1", decision: "maybe" })).toThrow(
      "INVALID_SESSION_INPUT",
    )
  })

  it("rejects malformed or oversized updatedPermissions", () => {
    expect(() =>
      readPermissionAnswer({
        requestId: "permission-1",
        decision: "allow",
        updatedPermissions: "all",
      }),
    ).toThrow("INVALID_SESSION_INPUT")
    expect(() =>
      readPermissionAnswer({
        requestId: "permission-1",
        decision: "allow",
        updatedPermissions: ["not-an-object"],
      }),
    ).toThrow("INVALID_SESSION_INPUT")
    expect(() =>
      readPermissionAnswer({
        requestId: "permission-1",
        decision: "allow",
        updatedPermissions: Array.from({ length: 51 }, () => ({ type: "setMode" })),
      }),
    ).toThrow("INVALID_SESSION_INPUT")
    expect(() =>
      readPermissionAnswer({
        requestId: "permission-1",
        decision: "allow",
        updatedPermissions: [{ type: "setMode", payload: "x".repeat(65 * 1024) }],
      }),
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
