// 验证多会话的 IPC：列出会话要可信来源和有效会员，状态按会话 id 查，启动时可以带会话 id，
// 不合规的会话 id 在交给宿主之前被拒绝，未知会话返回宿主的「会话不存在」。

import type { IpcMainInvokeEvent } from "electron"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHarness, type SessionHarness } from "./session-host-fixtures"
import { readSessionStartInput, registerSessionIpc } from "./session-ipc"
import { trackSessionCommandCatalogs } from "./session-command-catalogs"

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

const temporaryDirs: string[] = []

beforeEach(() => {
  handlers.clear()
})

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("session IPC with several sessions", () => {
  it("枚举未启动项目的命令，并为运行中的会话返回独立的 SDK 命令", async () => {
    const harness = await registered()
    trackSessionCommandCatalogs(harness.host)
    const workspace = harness.workspace
    const directory = join(workspace, ".claude", "commands")
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, "local.md"), "synthetic")
      await expect(invoke("pigclaude:session-commands", { workspace }, false)).rejects.toThrow(
        "UNTRUSTED_SESSION_REQUEST",
      )
      await expect(invoke("pigclaude:session-commands", { workspace })).resolves.toContainEqual({
        name: "local",
        kind: "skill",
        text: "/local",
      })
      expect(harness.adapters.instances).toHaveLength(0)
      await invoke("pigclaude:session-start", startInput(harness, "draft-a"))
      harness.adapters.last.emit({
        type: "commands-changed",
        commands: [{ name: "available", kind: "skill", text: "/available" }],
      })
      await expect(
        invoke("pigclaude:session-commands", { workspace, sessionId: "draft-a" }),
      ).resolves.toEqual([{ name: "available", kind: "skill", text: "/available" }])
      await expect(
        invoke("pigclaude:session-commands", { workspace, sessionId: "other" }),
      ).resolves.toContainEqual({ name: "local", kind: "skill", text: "/local" })
    } finally {
      await harness.host.dispose()
    }
  })
  it("lists every session as a redacted summary for a trusted sender", async () => {
    const harness = await registered()
    const first = await invoke("pigclaude:session-start", startInput(harness, "draft-a"))
    const second = await invoke("pigclaude:session-start", startInput(harness))
    await harness.host.stop("draft-a")

    const listed = await invoke("pigclaude:session-list")

    expect(first).toEqual({ sessionId: "draft-a" })
    expect(listed).toEqual([
      expect.objectContaining({
        sessionId: "draft-a",
        workspace: harness.workspace,
        status: "parked",
      }),
      expect.objectContaining({ ...(second as object), status: "idle", pendingPermissions: 0 }),
    ])
    expect(JSON.stringify(listed)).not.toContain(harness.runtime.sessions[0]?.token ?? "?")
    await expect(invoke("pigclaude:session-list", undefined, false)).rejects.toThrow(
      "UNTRUSTED_SESSION_REQUEST",
    )
    harness.membership.setState("expired")
    await expect(invoke("pigclaude:session-list")).rejects.toThrow(/MEMBERSHIP_REQUIRED/)
    await harness.host.dispose()
  })

  it("reads status by session id and reports unknown sessions", async () => {
    const harness = await registered()
    await invoke("pigclaude:session-start", startInput(harness, "draft-a"))

    await expect(
      invoke("pigclaude:session-status", { sessionId: "draft-a" }),
    ).resolves.toMatchObject({ active: true, sessionId: "draft-a" })
    await expect(invoke("pigclaude:session-status", { sessionId: "missing" })).rejects.toThrow(
      /SESSION_NOT_FOUND/,
    )
    await expect(invoke("pigclaude:session-status", {})).rejects.toThrow("INVALID_SESSION_INPUT")
    await expect(
      invoke("pigclaude:session-send", { sessionId: "missing", text: "hi" }),
    ).rejects.toThrow(/SESSION_NOT_FOUND/)
    await harness.host.dispose()
  })

  it("closes the session tools when the session parks", async () => {
    const close = vi.fn()
    const harness = await registered({ close })
    await invoke("pigclaude:session-start", startInput(harness, "draft-a"))

    expect(close).not.toHaveBeenCalled()
    await invoke("pigclaude:session-stop", { sessionId: "draft-a" })
    expect(close).toHaveBeenCalledTimes(1)
    await harness.host.dispose()
  })
})

describe("readSessionStartInput session id", () => {
  it("accepts a path-safe session id and rejects anything else", () => {
    const base = { workspace: "/Users/me/app", permissionMode: "default" }

    expect(readSessionStartInput({ ...base, sessionId: "3f6c2a1e-draft_1" })).toEqual({
      ...base,
      sessionId: "3f6c2a1e-draft_1",
    })
    for (const sessionId of ["", "../escape", "-leading", "a/b", "x".repeat(129), 7]) {
      expect(() => readSessionStartInput({ ...base, sessionId })).toThrow("INVALID_SESSION_INPUT")
    }
  })
})

async function registered(tools?: { close: () => void }): Promise<SessionHarness> {
  const harness = createHarness({ workspace: await workspaceDir() })
  registerSessionIpc({
    getHost: () => harness.host,
    getUsage: () => null,
    isTrusted: (value) => (value as unknown as { trusted: boolean }).trusted,
    ...(tools === undefined ? {} : { tools: () => ({ servers: {}, close: tools.close }) }),
  })
  return harness
}

function invoke(channel: string, value?: unknown, trusted = true): Promise<unknown> {
  const registered = handlers.get(channel)
  if (registered === undefined) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve().then(() =>
    registered({ trusted } as unknown as IpcMainInvokeEvent, value),
  )
}

function startInput(harness: SessionHarness, sessionId?: string) {
  return {
    workspace: harness.workspace,
    permissionMode: "default",
    ...(sessionId === undefined ? {} : { sessionId }),
  }
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-ipc-"))
  temporaryDirs.push(dir)
  return dir
}
