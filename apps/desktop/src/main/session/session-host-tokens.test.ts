// 验证会话宿主按会话使用 daemon 令牌：会话启动时注册、结束时吊销，环境和脱敏都用本会话的令牌，
// 换号事件只交给它所属的会话，模型目录查询用自己的临时令牌。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createHarness,
  currentSessionId,
  waitUntil,
  type SessionHarness,
} from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost daemon tokens", () => {
  it("registers a token with the preferred account at start and revokes it when the session stops", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })

    await harness.host.start({ ...startInput(harness), accountId: "account-1" })

    expect(harness.runtime.sessions).toMatchObject([
      { sessionId: "id-1", preferredAccountId: "account-1", closed: false },
    ])
    const token = harness.runtime.sessions[0]?.token
    expect(harness.environments.inputs[0]?.sessionToken).toBe(token)
    await harness.host.stop(currentSessionId(harness.host))
    expect(harness.runtime.sessions[0]?.closed).toBe(true)
    await harness.host.dispose()
  })

  it("binds the session's own locale and timezone through its token's runtime session", async () => {
    const harness = createHarness({
      workspace: await workspaceDir(),
      resolveProfile: { timezone: "Asia/Tokyo", locale: "ja-JP" },
    })

    await harness.host.start(startInput(harness))

    expect(harness.runtime.sessions[0]?.bound).toEqual([
      { timezone: "Asia/Tokyo", locale: "ja-JP" },
    ])
    expect(harness.environments.inputs[0]).toMatchObject({
      timezone: "Asia/Tokyo",
      locale: "ja-JP",
      sessionToken: harness.runtime.sessions[0]?.token,
    })
    await harness.host.dispose()
  })

  it("revokes the token when Claude Code exits on its own", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    await harness.host.start(startInput(harness))

    harness.adapters.last.emit({ type: "ended", reason: "error" })

    await waitUntil(() => harness.runtime.sessions[0]?.closed === true)
    expect(harness.host.status().active).toBe(false)
    await harness.host.dispose()
  })

  it("revokes the token when a start is cancelled after the token was registered", async () => {
    const harness = createHarness({
      workspace: await workspaceDir(),
      resolveBinaryPath: () => {
        void harness.host.stop()
        return "/fake/claude"
      },
    })

    await expect(harness.host.start(startInput(harness))).rejects.toMatchObject({
      code: "SESSION_CANCELLED",
    })
    expect(harness.environments.inputs).toHaveLength(0)
    expect(harness.runtime.sessions).toMatchObject([{ sessionId: "id-1", closed: true }])
    await harness.host.dispose()
  })

  it("revokes the token when a start is cancelled while Claude Code is starting", async () => {
    const harness = createHarness({ workspace: await workspaceDir(), holdAdapterStart: true })

    const starting = harness.host.start(startInput(harness))
    await waitUntil(() => harness.adapters.instances.length === 1)
    const stopping = harness.host.stop()
    harness.adapters.last.releaseStart()

    await expect(starting).rejects.toMatchObject({ code: "SESSION_CANCELLED" })
    await stopping
    expect(harness.runtime.sessions).toMatchObject([{ sessionId: "id-1", closed: true }])
    await harness.host.dispose()
  })

  it("records usage on the account its own session used, ignoring another session's switch", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    await harness.host.start({ ...startInput(harness), accountId: "account-a" })
    await harness.host.stop(currentSessionId(harness.host))
    await harness.host.start({ ...startInput(harness), accountId: "account-b" })
    const sessionId = currentSessionId(harness.host)

    await harness.host.send(sessionId, { text: "hello" })
    harness.runtime.switchAccount("account-a", "account-c", "quota", "id-1")
    harness.adapters.last.emit(resultEvent())
    await waitUntil(() => harness.usage.records.length === 1)

    expect(harness.usage.records).toMatchObject([
      { sessionId, accountId: "account-b", switchedFrom: null },
    ])
    await harness.host.dispose()
  })

  it("revokes the token when membership ends the session", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    await harness.host.start(startInput(harness))

    harness.membership.setState("expired")

    await waitUntil(() => harness.runtime.sessions[0]?.closed === true)
    await harness.host.dispose()
  })

  it("revokes the token registered for a start that fails", async () => {
    const harness = createHarness({
      workspace: await workspaceDir(),
      resolveBinaryPath: () => {
        throw new Error(`missing binary for ${harness.runtime.sessionToken}`)
      },
    })

    await expect(harness.host.start(startInput(harness))).rejects.toMatchObject({
      code: "CLAUDE_RUNTIME_UNAVAILABLE",
      message: "CLAUDE_RUNTIME_UNAVAILABLE: missing binary for [redacted]",
    })
    expect(harness.runtime.sessions).toMatchObject([{ sessionId: "id-1", closed: true }])
    await harness.host.dispose()
  })

  it("gives the next session a new token and redacts that session's token", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    await harness.host.start(startInput(harness))
    await harness.host.stop(currentSessionId(harness.host))
    await harness.host.start(startInput(harness))
    const [first, second] = harness.runtime.sessions

    harness.adapters.last.emit({
      type: "error",
      code: "SDK_ERROR",
      message: `request failed with ${second?.token ?? ""}`,
    })

    expect(first?.token).not.toBe(second?.token)
    expect(harness.environments.inputs[1]?.sessionToken).toBe(second?.token)
    expect(harness.events.at(-1)).toEqual({
      type: "error",
      code: "SDK_ERROR",
      message: "request failed with [redacted]",
    })
    await harness.host.dispose()
  })

  it("applies an account switch only to the session it belongs to", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    await harness.host.start({ ...startInput(harness), accountId: "account-1" })

    harness.runtime.switchAccount(null, "other-account", "initial", "another-session")

    expect(harness.events.filter((event) => event.type === "account-switched")).toEqual([])
    expect(harness.host.status().accountId).toBe("account-1")
    harness.runtime.switchAccount(null, "account-2", "initial", "id-1")
    expect(harness.host.status().accountId).toBe("account-2")
    await harness.host.dispose()
  })

  it("reads the model catalog with its own short-lived token", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })

    await harness.host.models()

    expect(harness.runtime.sessions).toMatchObject([{ preferredAccountId: null, closed: true }])
    const token = harness.runtime.sessions[0]?.token
    expect(harness.bootstrapReads.map((read) => read.sessionToken)).toEqual([token])
    expect(harness.environments.inputs[0]?.sessionToken).toBe(token)
    await harness.host.dispose()
  })
})

function resultEvent() {
  return {
    type: "result" as const,
    subtype: "success",
    isError: false,
    durationMs: 1_200,
    numTurns: 1,
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 },
  }
}

function startInput(harness: SessionHarness) {
  return { workspace: harness.workspace, permissionMode: "default" as const }
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-tokens-"))
  temporaryDirs.push(dir)
  return dir
}
