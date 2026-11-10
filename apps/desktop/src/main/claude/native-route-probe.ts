// 分别使用生产 daemon 和刷新器创建的客户端查询固定出口，不调用真实模型或真实 token 刷新。

import { randomUUID } from "node:crypto"
import { LocalDaemon } from "@pigclaude/daemon"
import type { AccountRecord } from "@pigclaude/local-store"
import { fetch as upstreamFetch, type Dispatcher } from "undici"
import type { NativeEnvironmentInput } from "./native-environment-model"
import { CredentialRefresher } from "./credential-refresher"
import { buildCredential } from "./account-service-record"
import { environmentResponseIp } from "./environment-address"
import { NativeDiagnosticCleanupError } from "./native-cli-probe"

/** 两条独立客户端路径实际取得的原始 IPv4，只供本机比较。 */
export type NativeRouteObservation = { daemonIp: string | null; refreshIp: string | null }

/** 走实际生产路由与客户端工厂；刷新传输用合成 token，不向 OAuth 服务发送凭据。 */
export async function probeNativeRoutes(
  input: NativeEnvironmentInput,
  target: string,
): Promise<NativeRouteObservation> {
  input.signal.throwIfAborted()
  const sessionToken = randomUUID()
  const controller = new AbortController()
  const abort = (): void => controller.abort(input.signal.reason)
  input.signal.addEventListener("abort", abort, { once: true })
  const url = new URL(target)
  const options = {
    port: 0,
    sessionToken,
    choose: () => ({
      id: "native-route-diagnostic",
      authorization: "unused-diagnostic",
      proxyUrl: input.proxyUrl,
    }),
    runAuthorized: async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> =>
      operation(controller.signal),
    upstreamOrigin: new URL(url.origin),
  }
  const daemon = new LocalDaemon(options)
  let dispatcher: Dispatcher | undefined
  const now = Date.now()
  const tokens = {
    accessToken: "unused-diagnostic",
    refreshToken: "unused-diagnostic",
    expiresAt: now + 60_000,
    scopes: [],
  }
  let account: AccountRecord = {
    schemaVersion: 3,
    id: "native-route-diagnostic",
    displayName: "合成刷新传输",
    enabled: true,
    credential: buildCredential({ ...tokens, expiresAt: now - 1 }, null, null),
    needsReauth: false,
    proxyId: input.proxyUrl === null ? null : "native-route-proxy",
    fingerprint: input.fingerprint,
    browserProfileDir: "/diagnostic-unused",
    exhaustedUntil: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
  let refreshIp: string | null = null
  const refresher = new CredentialRefresher({
    store: {
      getProxy: async () =>
        input.proxyUrl === null
          ? null
          : {
              schemaVersion: 1,
              id: "native-route-proxy",
              name: "临时内存诊断",
              url: input.proxyUrl,
              lastTest: null,
            },
      updateAccount: async (_id, update) => {
        const next = typeof update === "function" ? update(account) : { ...account, ...update }
        if (next) account = next
        return next
      },
    },
    oauth: {
      refresh: async (request) => {
        dispatcher = request.dispatcher
        const response = await upstreamFetch(target, {
          method: "GET",
          headers: { "user-agent": "PigClaude-environment-check/2" },
          dispatcher,
          signal: input.signal,
          redirect: "error",
        })
        refreshIp =
          response.status === 200 ? environmentResponseIp(await limitedBody(response)) : null
        return tokens
      },
    },
  })
  const cleanup = async (): Promise<void> => {
    input.signal.removeEventListener("abort", abort)
    controller.abort()
    const results = await Promise.allSettled([daemon.stop(), dispatcher?.destroy()])
    if (results.some((result) => result.status === "rejected"))
      throw new NativeDiagnosticCleanupError(cleanup)
  }
  try {
    input.signal.throwIfAborted()
    await daemon.start()
    const [daemonResult, refreshResult] = await Promise.allSettled([
      (async () => {
        const response = await upstreamFetch(
          `http://127.0.0.1:${daemon.port}${url.pathname}${url.search}`,
          {
            headers: {
              "x-pigclaude-session": sessionToken,
              "user-agent": "PigClaude-environment-check/2",
            },
            signal: input.signal,
            redirect: "error",
          },
        )
        return response.status === 200 ? environmentResponseIp(await limitedBody(response)) : null
      })(),
      refresher.refresh(account),
    ])
    // 两条路径均已结束后才能销毁刷新器客户端，避免与其 finally 中的 close 交叉。
    if (daemonResult.status === "rejected") throw daemonResult.reason
    if (refreshResult.status === "rejected") throw refreshResult.reason
    return { daemonIp: daemonResult.value, refreshIp }
  } finally {
    await cleanup()
  }
}

async function limitedBody(response: Awaited<ReturnType<typeof upstreamFetch>>): Promise<string> {
  if (!response.body) throw new Error("出口服务没有正文")
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 65_536) {
      await response.body.cancel()
      throw new Error("出口正文超过上限")
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}
