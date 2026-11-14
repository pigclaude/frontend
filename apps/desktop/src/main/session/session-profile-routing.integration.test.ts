// 从公开会话入口和真实本机 daemon 验证：CLI 环境不变时不能换入不同语言或时区的账号。

import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { LocalStore, type AccountRecord } from "@pigclaude/local-store"
import { LocalDaemon } from "@pigclaude/daemon"
import { SessionHost } from "./session-host"
import { SessionEnvironment } from "./session-environment"
import { UsageRecorder } from "./usage-recorder"
import { LocalRuntime } from "../runtime/local-runtime"
import { AccountChooser } from "../runtime/account-chooser"
import { accountSessionProfile } from "./account-session-profile"
import { membershipView } from "../testing/profile-fixture"
import { fingerprint } from "../claude/account-service-test-fixtures"

it.each([
  { language: "en-US", timezone: "America/New_York", expectedStatus: 200, requests: 2 },
  { language: "ja-JP", timezone: "Asia/Tokyo", expectedStatus: 503, requests: 1 },
])(
  "CLI 启动后只换入兼容环境 $language/$timezone",
  async (options) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-session-profile-routing-"))
    const store = new LocalStore(join(directory, "local"))
    await store.saveAccount(account("a", "en-US", "America/New_York"))
    await store.saveAccount(account("b", options.language, options.timezone))
    const observed: string[] = []
    const origin = createServer((request, response) => {
      request.resume()
      const authorization = request.headers.authorization ?? ""
      observed.push(authorization)
      if (authorization === "Bearer synthetic-a") response.setHeader("x-quota-exhausted", "1")
      response.writeHead(authorization === "Bearer synthetic-a" ? 429 : 200, {
        "content-type": "application/json",
      })
      response.end(JSON.stringify({ synthetic: true }))
    })
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve))
    const address = origin.address()
    if (!address || typeof address === "string") throw new Error("合成原始服务未监听")
    const view = membershipView()
    const membership = {
      view: () => view,
      inspect: async () => view,
      subscribe: () => () => undefined,
    }
    const runtime = new LocalRuntime({
      store,
      chooser: new AccountChooser({
        store,
        refresher: { refreshIfNeeded: async (value) => value },
      }),
      membership,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      createDaemon: (input) =>
        new LocalDaemon({ ...input, upstreamOrigin: new URL(`http://127.0.0.1:${address.port}`) }),
    })
    let status: number | undefined
    let actualEnvironment: Record<string, string> = {}
    const host = new SessionHost({
      membership,
      runtime,
      userDataPath: directory,
      resolveBinaryPath: () => "/synthetic/claude",
      usage: new UsageRecorder({ filePath: join(directory, "usage.jsonl") }),
      resolveProfile: (id) => accountSessionProfile(store, id, () => "en-US"),
      createEnvironment: SessionEnvironment.create,
      createAdapter: () => ({
        start: async (input) => {
          actualEnvironment = input.env
        },
        send: async () => {
          const response = await fetch(`${runtime.daemonBaseUrl}/v1/messages`, {
            method: "POST",
            headers: {
              "x-pigclaude-session": sessionTokenOf(actualEnvironment),
              "content-type": "application/json",
            },
            body: JSON.stringify({ synthetic: true }),
          })
          status = response.status
          await response.text()
        },
        interrupt: async () => undefined,
        stopTask: async () => undefined,
        stop: async () => undefined,
        models: async () => [],
        setModel: async () => undefined,
        setPermissionMode: async () => undefined,
        contextUsage: async () => ({}),
      }),
    })
    try {
      await runtime.start()
      const { sessionId } = await host.start({
        workspace: directory,
        accountId: "a",
        permissionMode: "default",
      })
      await host.send(sessionId, { text: "synthetic environment routing" })
      expect(actualEnvironment.TZ).toBe("America/New_York")
      expect(actualEnvironment.LANG).toBe(process.platform === "win32" ? "en-US" : "en_US.UTF-8")
      expect(status).toBe(options.expectedStatus)
      expect(observed).toHaveLength(options.requests)
    } finally {
      await host.dispose()
      await runtime.dispose()
      await new Promise<void>((resolve) => origin.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  },
  20_000,
)

function account(id: string, lang: string, timezone: string): AccountRecord {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    enabled: true,
    needsReauth: false,
    proxyId: null,
    fingerprint: { ...fingerprint, lang, timezone },
    browserProfileDir: "",
    exhaustedUntil: null,
    createdAt: "",
    updatedAt: "",
    credential: {
      schemaVersion: 1,
      accessToken: `synthetic-${id}`,
      refreshToken: `synthetic-refresh-${id}`,
      expiresAt: Date.now() + 86_400_000,
      scopes: [],
      accountUuid: id,
      email: null,
      organizationUuid: null,
      subscriptionType: null,
      rateLimitTier: null,
    },
  }
}

// 和 Claude Code 一样，从会话环境的自定义请求头里取本会话的 daemon 令牌。
function sessionTokenOf(env: Record<string, string>): string {
  return (env.ANTHROPIC_CUSTOM_HEADERS ?? "").replace(/^x-pigclaude-session: /, "")
}
