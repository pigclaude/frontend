// 用随包 Claude Code、真实 daemon 和本机假上游验证模型目录查询：组织模型经 daemon 读到并进入目录，
// Claude Code 的环境和配置目录里没有真实凭据，查询期间不出站；账号代理不可用时不直连，只列内置模型并提示。
// 没有随包 Claude Code 时跳过。

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { LocalDaemon } from "@pigclaude/daemon"
import { LocalStore, type AccountRecord } from "@pigclaude/local-store"
import { fingerprint } from "../claude/account-service-test-fixtures"
import { AccountChooser } from "../runtime/account-chooser"
import { LocalRuntime } from "../runtime/local-runtime"
import { membershipView } from "../testing/profile-fixture"
import { accountSessionProfile } from "./account-session-profile"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { SessionEnvironment } from "./session-environment"
import { SessionHost } from "./session-host"
import type { SessionHostEvent, SessionModelCatalog } from "./session-types"
import { UsageRecorder } from "./usage-recorder"

const binary = bundledBinary()
const accessToken = "synthetic-catalog-access"
const refreshToken = "synthetic-catalog-refresh"
const builtinAliases = ["default", "sonnet", "fable", "opus", "haiku"]
const cleanups: Array<() => Promise<void>> = []

type UpstreamRequest = {
  method: string | undefined
  url: string | undefined
  authorization: string | undefined
  userAgent: string | undefined
  beta: string | undefined
  session: string | undefined
}

type CatalogRun = {
  catalog: SessionModelCatalog
  events: SessionHostEvent[]
  switches: number
  upstream: UpstreamRequest[]
  outbound: string[]
  environments: Array<{ env: Record<string, string>; config: string | null }>
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it.skipIf(!binary)(
  "lists the organization models read through the daemon without giving Claude Code a credential",
  async () => {
    const run = await queryCatalog(null)

    const ids = run.catalog.models.map((model) => model.id)
    expect(ids).toEqual(expect.arrayContaining([...builtinAliases, "claude-org-catalog-1"]))
    expect(run.catalog.models.find((model) => model.id === "claude-org-catalog-1")).toMatchObject({
      displayName: "Org Catalog 1",
    })
    expect(run.catalog.cliError).toBeNull()
    expect(run.upstream).toEqual([
      {
        method: "GET",
        url: "/api/claude_cli/bootstrap?entrypoint=sdk-ts&model=claude-sonnet-5-5",
        authorization: `Bearer ${accessToken}`,
        userAgent: "claude-code/2.1.310",
        beta: "oauth-2025-04-20",
        session: undefined,
      },
    ])
    expect(run.outbound).toEqual([])
    expect(run.environments).toHaveLength(1)
    const [environment] = run.environments
    expect(environment?.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("pigclaude-local")
    expect(environment?.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1")
    expect(environment?.config).toContain("claude-org-catalog-1")
    for (const secret of [accessToken, refreshToken]) {
      expect(JSON.stringify(environment?.env)).not.toContain(secret)
      expect(environment?.config).not.toContain(secret)
    }
    expect(environment?.config).not.toContain("oauthAccount")
    expect(run.events).toEqual([])
    expect(run.switches).toBe(0)
  },
  60_000,
)

it.skipIf(!binary)(
  "lists only the built-in models and tells the user when the bound proxy is unusable",
  async () => {
    const run = await queryCatalog("http://127.0.0.1:1")

    const ids = run.catalog.models.map((model) => model.id)
    expect(ids).toEqual(expect.arrayContaining(builtinAliases))
    expect(ids).not.toContain("claude-org-catalog-1")
    expect(run.catalog.cliError).toBeNull()
    expect(run.upstream).toEqual([])
    expect(run.outbound).toEqual([])
    expect(run.events).toEqual([
      { type: "notice", message: "暂时读不到 Claude 账号所在组织的模型，只显示内置模型。" },
    ])
    expect(run.switches).toBe(0)
  },
  60_000,
)

async function queryCatalog(proxyUrl: string | null): Promise<CatalogRun> {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-model-catalog-"))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const store = new LocalStore(join(directory, "local"))
  if (proxyUrl !== null) {
    await store.saveProxy({
      schemaVersion: 1,
      id: "bound",
      name: "bound",
      url: proxyUrl,
      lastTest: null,
    })
  }
  await store.saveAccount(account(proxyUrl === null ? null : "bound"))

  const upstream: UpstreamRequest[] = []
  const origin = await listen(
    createServer((request, response) => {
      request.resume()
      upstream.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        userAgent: request.headers["user-agent"],
        beta: headerValue(request.headers, "anthropic-beta"),
        session: headerValue(request.headers, "x-pigclaude-session"),
      })
      const bootstrap = request.url?.startsWith("/api/claude_cli/bootstrap?") === true
      response.writeHead(bootstrap ? 200 : 404, { "content-type": "application/json" })
      response.end(
        JSON.stringify(
          bootstrap
            ? {
                additional_model_options: [
                  {
                    model: "claude-org-catalog-1",
                    name: "Org Catalog 1",
                    description: "Organization catalog model",
                  },
                ],
              }
            : { type: "error" },
        ),
      )
    }),
  )
  const outbound: string[] = []
  const watch = createServer((request, response) => {
    outbound.push(`${request.method ?? ""} ${request.url ?? ""}`)
    response.writeHead(502)
    response.end()
  })
  watch.on("connect", (request, socket) => {
    outbound.push(`CONNECT ${request.url ?? ""}`)
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
  })
  const watchUrl = await listen(watch)

  const view = membershipView()
  const membership = {
    view: () => view,
    inspect: async () => view,
    subscribe: () => () => undefined,
  }
  const runtime = new LocalRuntime({
    store,
    chooser: new AccountChooser({ store, refresher: { refreshIfNeeded: async (value) => value } }),
    membership,
    runAuthorized: async (operation) => operation(new AbortController().signal),
    createDaemon: (input) => new LocalDaemon({ ...input, upstreamOrigin: new URL(origin) }),
  })
  cleanups.push(() => runtime.dispose())
  let switches = 0
  runtime.subscribe(() => {
    switches += 1
  })
  const environments: CatalogRun["environments"] = []
  const host = new SessionHost({
    membership,
    runtime,
    userDataPath: directory,
    usage: new UsageRecorder({ filePath: join(directory, "usage.jsonl") }),
    resolveBinaryPath: () => binary ?? "",
    defaultWorkspace: () => directory,
    resolveProfile: (id) => accountSessionProfile(store, id, () => "en-US"),
    createAdapter: (onEvent) => new ClaudeAgentAdapter({ onEvent }),
    createEnvironment: async (input) => {
      const environment = await SessionEnvironment.create(input)
      const config = await readFile(join(environment.configDir, ".claude.json"), "utf8").catch(
        () => null,
      )
      environments.push({ env: { ...environment.env }, config })
      return {
        env: { ...environment.env, HTTPS_PROXY: watchUrl, HTTP_PROXY: watchUrl },
        configDir: environment.configDir,
        sessionDir: environment.sessionDir,
        workspace: environment.workspace,
        binaryPath: environment.binaryPath,
        timezone: environment.timezone,
        cleanup: () => environment.cleanup(),
      }
    },
  })
  cleanups.push(() => host.dispose())
  const events: SessionHostEvent[] = []
  host.subscribe((event) => events.push(event))

  await runtime.start()
  const catalog = await host.models()
  return { catalog, events, switches, upstream, outbound, environments }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("本机服务没有监听")
  return `http://127.0.0.1:${address.port}`
}

function account(proxyId: string | null): AccountRecord {
  return {
    schemaVersion: 3,
    id: "catalog-account",
    displayName: "catalog",
    enabled: true,
    needsReauth: false,
    proxyId,
    fingerprint,
    browserProfileDir: "",
    exhaustedUntil: null,
    createdAt: "",
    updatedAt: "",
    credential: {
      schemaVersion: 1,
      accessToken,
      refreshToken,
      expiresAt: Date.now() + 86_400_000,
      scopes: [],
      accountUuid: "catalog-account-uuid",
      email: "catalog@example.test",
      organizationUuid: "catalog-organization-uuid",
      subscriptionType: null,
      rateLimitTier: null,
    },
  }
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

function bundledBinary(): string | undefined {
  try {
    return resolveClaudeBinaryPath()
  } catch {
    return undefined
  }
}
