// 向权限服务确认许可证能否使用。远程允许时记下结果。明确拒绝、无法识别的成功正文和 HTTP 4xx 会清掉同一许可证的允许缓存。连不上、超过 10 秒没有结果，以及 HTTP 5xx，才沿用同一许可证的上次允许。

import { readFile, rm, writeFile } from "node:fs/promises"

/** 一次权限判断。保证带上是否允许、核对时间，以及结果来自远程还是缓存。 */
export type PermissionDecision = {
  allowed: boolean
  checkedAt: string
  source: "remote" | "cache"
}

type PermissionCheckInput = {
  endpoint: string
  license: string
  cachePath: string
  fetchImpl?: typeof fetch
  now?: () => Date
}

type RemoteBody = {
  allowed: boolean
  checkedAt: string
}

type CachedAllow = {
  license: string
  allowed: true
  checkedAt: string
}

type RemoteResult =
  | { outcome: "unreachable" }
  | { outcome: "decision"; body: RemoteBody }
  | { outcome: "closed" }
  | { outcome: "clientError" }

// 权限检查超过这个时间还没结束，就按连不上处理，可以读缓存。
const permissionDeadlineMs = 10_000

/** 请求权限接口。带核对时间的远程允许会写入缓存。明确拒绝、无法识别的 2xx 和 HTTP 4xx 会清掉同一许可证的允许缓存。网络失败、超过 10 秒未完成和 HTTP 5xx 才沿用上次允许。 */
export async function checkPermission(input: PermissionCheckInput): Promise<PermissionDecision> {
  const now = input.now ?? (() => new Date())
  const remote = await requestRemote(input.endpoint, input.license, input.fetchImpl ?? fetch)
  if (remote.outcome === "unreachable") return cachedDecision(input.cachePath, input.license, now)
  if (remote.outcome === "clientError" || remote.outcome === "closed") {
    await clearCachedAllow(input.cachePath, input.license)
    return { allowed: false, checkedAt: now().toISOString(), source: "remote" }
  }
  if (!remote.body.allowed) await clearCachedAllow(input.cachePath, input.license)
  if (remote.body.allowed) {
    await writeFile(
      input.cachePath,
      JSON.stringify({ license: input.license, allowed: true, checkedAt: remote.body.checkedAt }),
      "utf8",
    )
  }
  return { allowed: remote.body.allowed, checkedAt: remote.body.checkedAt, source: "remote" }
}

/** 保证只有允许使用时才能开始会话。 */
export function mayStartSession(decision: PermissionDecision): boolean {
  return decision.allowed
}

async function requestRemote(
  endpoint: string,
  license: string,
  fetchImpl: typeof fetch,
): Promise<RemoteResult> {
  const abort = new AbortController()
  const timer = setTimeout(() => {
    abort.abort()
  }, permissionDeadlineMs)
  try {
    const result = await Promise.race([
      readRemote(endpoint, license, fetchImpl, abort.signal).then(
        (value) => value,
        () => ({ outcome: "unreachable" as const }),
      ),
      waitForAbort(abort.signal),
    ])
    if (abort.signal.aborted) return { outcome: "unreachable" }
    return result
  } finally {
    clearTimeout(timer)
    if (!abort.signal.aborted) abort.abort()
  }
}

async function readRemote(
  endpoint: string,
  license: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<RemoteResult> {
  const response = await fetchImpl(`${endpoint}/v1/permission/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ license }),
    signal,
  })
  if (signal.aborted) {
    void response.body?.cancel().catch(() => undefined)
    return { outcome: "unreachable" }
  }
  if (response.status >= 400 && response.status < 500) {
    void response.body?.cancel().catch(() => undefined)
    return { outcome: "clientError" }
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    return { outcome: "unreachable" }
  }
  try {
    const body: unknown = await response.json()
    if (signal.aborted) return { outcome: "unreachable" }
    if (isRemoteBody(body)) return { outcome: "decision", body }
  } catch {
    if (signal.aborted) return { outcome: "unreachable" }
    // 2xx 但不是 JSON 时拒绝，不能当成网络失败去读缓存。
  }
  return { outcome: "closed" }
}

function waitForAbort(signal: AbortSignal): Promise<RemoteResult> {
  if (signal.aborted) return Promise.resolve({ outcome: "unreachable" })
  return new Promise((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve({ outcome: "unreachable" })
      },
      { once: true },
    )
  })
}

function isRemoteBody(body: unknown): body is RemoteBody {
  if (typeof body !== "object" || body === null) return false
  if (!("allowed" in body) || !("checkedAt" in body)) return false
  return typeof body.allowed === "boolean" && typeof body.checkedAt === "string"
}

function isCachedAllow(value: unknown): value is CachedAllow {
  if (typeof value !== "object" || value === null) return false
  if (!("license" in value) || !("allowed" in value) || !("checkedAt" in value)) return false
  return (
    typeof value.license === "string" &&
    value.allowed === true &&
    typeof value.checkedAt === "string"
  )
}

// 只删除同一许可证的允许缓存。读不到文件时保持原样；删不掉则让这次判断失败，避免拒绝之后仍留下允许。
async function clearCachedAllow(cachePath: string, license: string): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(cachePath, "utf8"))
  } catch {
    return
  }
  if (isCachedAllow(parsed) && parsed.license === license) await rm(cachePath, { force: true })
}

async function cachedDecision(
  cachePath: string,
  license: string,
  now: () => Date,
): Promise<PermissionDecision> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath, "utf8"))
    if (isCachedAllow(parsed) && parsed.license === license) {
      return { allowed: true, checkedAt: parsed.checkedAt, source: "cache" }
    }
  } catch {
    // 没有可读缓存时拒绝，不把离线当成允许。
  }
  return { allowed: false, checkedAt: now().toISOString(), source: "cache" }
}
