// 仅在自有临时目录和loopback HTTP边界生成合成客户端材料，不接触真实账号、机器标识或系统Keychain。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { LocalStore, type AccountRecord, type IpProxy } from "@pigclaude/local-store"
import type { DesktopRecoverySnapshot } from "@pigclaude/contracts/desktop-membership"
import type { DesktopComposition } from "../composition"
import { createDesktopComposition } from "../composition"
import { FileSecretVault, type SecretVault } from "../secret-vault"
import { DeviceIdentityService } from "../device-identity"
import { deferred, fixtureSafeStorage, oauthSessionFixture } from "./profile-fixture"

type Mode = "active" | "expired" | "invalid"
type Call = { path: string; authorization: string | undefined; form: URLSearchParams }

/** 创建真实HTTP客户端组合夹具；服务端是可控协议替身，双PG/Redis隔离另由实际验收证明。 */
export async function createCrossEnvironmentClientFixture() {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-environment-client-"))
  const vaultPath = join(directory, "secrets.json")
  const vault = new FileSecretVault(vaultPath, fixtureSafeStorage)
  const localStore = new LocalStore(directory)
  const identity = new DeviceIdentityService({
    read: async () => ({ platform: "darwin", machineId: "0123456789abcdef0123456789abcdef" }),
  })
  const device = await identity.read()
  const original = {
    ...oauthSessionFixture(),
    userId: "42",
    authVersion: "1",
    bindingEpoch: "1",
    deviceId: device.deviceId,
    accessToken: "synthetic-old-environment-access",
    refreshToken: "synthetic-old-environment-refresh",
  }
  await vault.set("membership:session", JSON.stringify(original))
  const preserved = await seedCrossEnvironmentLocalState({ directory, vault, localStore })
  const sessionEntered = deferred<void>()
  const releaseSession = deferred<void>()
  const refreshEntered = deferred<void>()
  const releaseRefresh = deferred<void>()
  let holdRefresh = false
  const calls: Call[] = []
  let mode: Mode = "active"
  let origin = ""
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.writeHead(500, { "content-type": "application/json" })
      response.end('{"error":"server_error"}')
    })
  })

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    const path = request.url ?? ""
    const form = new URLSearchParams(body)
    calls.push({ path, authorization: request.headers.authorization, form })
    const send = (status: number, value: unknown) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      response.end(JSON.stringify(value))
    }
    if (path === "/v1/desktop/oauth/contexts") {
      const input = JSON.parse(body) as Record<string, string | string[]>
      const url = new URL("/oauth2/authorize", origin)
      for (const [name, value] of Object.entries({
        response_type: "code",
        client_id: String(input.clientId),
        redirect_uri: String(input.redirectUri),
        code_challenge: String(input.codeChallenge),
        code_challenge_method: "S256",
        state: String(input.state),
        scope: (input.scopes as string[]).join(" "),
        device_context: "synthetic-context",
      }))
        url.searchParams.set(name, value)
      send(200, {
        contextId: "synthetic-context",
        authorizationUrl: url.toString(),
        expiresAt: new Date(600_000).toISOString(),
      })
      return
    }
    if (path === "/oauth2/token") {
      if (form.get("grant_type") === "refresh_token") {
        if (holdRefresh) {
          refreshEntered.resolve(undefined)
          await releaseRefresh.promise
        }
        send(400, { error: "invalid_grant" })
        return
      }
      const prefix = form.get("code") === "old-code" ? "old-code" : "fresh"
      send(200, {
        access_token: `synthetic-${prefix}-access`,
        refresh_token: `synthetic-${prefix}-refresh`,
        token_type: "Bearer",
        expires_in: 300,
        scope: original.scope,
      })
      return
    }
    if (path === "/v1/desktop/session") {
      if (request.headers.authorization === "Bearer synthetic-old-code-access") {
        sessionEntered.resolve(undefined)
        await releaseSession.promise
      }
      send(200, original)
      return
    }
    if (path === "/v1/desktop/recovery") {
      if (mode === "invalid") {
        send(401, { error: "invalid_token" })
        return
      }
      send(200, recovery(mode))
      return
    }
    if (path === "/v1/desktop/membership-targets") {
      send(401, { error: "invalid_token" })
      return
    }
    if (path === "/v1/desktop/membership/inspect") {
      send(200, original)
      return
    }
    if (path === "/v1/desktop/entitlement") {
      send(200, { status: mode, tier: { code: "vip", name: "VIP", level: 1 }, validUntil: null })
      return
    }
    send(404, { error: "invalid_request" })
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string")
    throw new Error("CLIENT_FIXTURE_PORT_MISSING")
  origin = `http://127.0.0.1:${address.port}`
  const compositions = new Set<DesktopComposition>()

  function recovery(state: "active" | "expired"): DesktopRecoverySnapshot {
    return {
      userId: original.userId,
      deviceId: original.deviceId,
      bindingEpoch: original.bindingEpoch,
      authVersion: original.authVersion,
      account: {
        userId: original.userId,
        email: "synthetic@example.invalid",
        nickname: "Synthetic user",
        avatar: "",
      },
      grantExpiresAt: new Date(original.refreshTokenExpiresAt).toISOString(),
      membership: {
        status: state,
        tier: { code: "vip", name: "VIP", level: 1 },
        validUntil: new Date(state === "active" ? 9_000_000 : 500).toISOString(),
        entitlementVersion: "1",
      },
      canRevoke: true,
    }
  }

  return {
    original,
    vault,
    vaultPath,
    directory,
    localStore,
    identity,
    preserved,
    calls,
    sessionEntered,
    releaseSession,
    refreshEntered,
    releaseRefresh,
    /** 只在测试请求发送前启用刷新响应屏障，不修改客户端本身。 */
    set holdRefresh(value: boolean) {
      holdRefresh = value
    },
    redirect: "pigclaude://authorize/callback",
    request: {
      purpose: "pigclaude-login",
      mode: "authorize",
      bridgeExit: "exit",
      daemonExit: "exit",
    } as const,
    get mode() {
      return mode
    },
    set mode(value: Mode) {
      mode = value
    },
    /** 重建真实组合根；reopen使用同一磁盘文件，不从内存沿用第一方会话。 */
    createComposition(reopen = false) {
      const composition = createDesktopComposition({
        vault: reopen ? new FileSecretVault(vaultPath, fixtureSafeStorage) : vault,
        localStore,
        deviceIdentity: identity,
        authOrigin: origin,
        apiOptions: { baseUrl: origin },
        openWebsite: async () => {
          throw new Error("INVALID_OLD_GRANT_MUST_NOT_OPEN_WEBSITE")
        },
        now: () => 1_000,
      })
      compositions.add(composition)
      return composition
    },
    /** 只在测试内核对一次性refresh请求，不输出请求材料。 */
    refreshRequests() {
      return calls
        .filter((call) => call.form.get("grant_type") === "refresh_token")
        .map((call) => call.form.get("refresh_token"))
    },
    /** 先取消本例组合与HTTP，再精确清理自身临时目录。 */
    async close() {
      releaseSession.resolve(undefined)
      releaseRefresh.resolve(undefined)
      for (const app of compositions) await app.dispose()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

/** 在调用方新建目录保存独立Claude、Fingerprint、Proxy和设备哨兵，返回原文件字节供保全比较。 */
export async function seedCrossEnvironmentLocalState(input: {
  directory: string
  vault: SecretVault
  localStore: LocalStore
}) {
  await input.vault.set(
    "authorization:claude-account:local-claude",
    "synthetic-claude-vault-secret",
  )
  await input.vault.set("device:identity", "independent-device-sentinel")
  await input.localStore.saveProxy(proxy())
  await input.localStore.saveAccount(account())
  return {
    accounts: await readFile(join(input.directory, "accounts.json")),
    proxies: await readFile(join(input.directory, "proxies.json")),
  }
}

function proxy(): IpProxy {
  return {
    schemaVersion: 1,
    id: "local-proxy",
    name: "Synthetic",
    url: "http://127.0.0.1:19999",
    lastTest: null,
  }
}

function account(): AccountRecord {
  return {
    schemaVersion: 3,
    id: "local-claude",
    displayName: "Synthetic Claude",
    enabled: false,
    credential: {
      schemaVersion: 1,
      accessToken: "synthetic-claude-access",
      refreshToken: "synthetic-claude-refresh",
      expiresAt: 9_000_000_000,
      scopes: ["user:inference"],
      accountUuid: null,
      email: null,
      organizationUuid: null,
      subscriptionType: null,
      rateLimitTier: null,
    },
    needsReauth: false,
    proxyId: "local-proxy",
    fingerprint: {
      seed: "same-user-fingerprint",
      brand: "Chrome",
      platform: "macOS",
      lang: "zh-CN",
      timezone: "Asia/Shanghai",
      canvasNoise: "1",
      clientRectsNoise: "0",
      unknownArgs: ["--keep-fixture"],
    },
    browserProfileDir: "owned-profile",
    exhaustedUntil: null,
    createdAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  }
}
