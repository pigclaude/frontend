// 向权限服务确认许可证能否使用。远程允许时记下结果，失败时只沿用同一许可证的上次允许。

import { readFile, writeFile } from "node:fs/promises"

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

/** 请求权限接口。远程允许时写入缓存；网络失败或非成功响应时，只有同一许可证的允许缓存可以放行。 */
export async function checkPermission(input: PermissionCheckInput): Promise<PermissionDecision> {
  const now = input.now ?? (() => new Date())
  const remote = await requestRemote(input.endpoint, input.license, input.fetchImpl ?? fetch)
  if (!remote) return cachedDecision(input.cachePath, input.license, now)
  if (remote.allowed) {
    await writeFile(
      input.cachePath,
      JSON.stringify({ license: input.license, allowed: true, checkedAt: remote.checkedAt }),
      "utf8",
    )
  }
  return { allowed: remote.allowed, checkedAt: remote.checkedAt, source: "remote" }
}

/** 保证只有允许使用时才能开始会话。 */
export function mayStartSession(decision: PermissionDecision): boolean {
  return decision.allowed
}

async function requestRemote(
  endpoint: string,
  license: string,
  fetchImpl: typeof fetch,
): Promise<RemoteBody | undefined> {
  try {
    const response = await fetchImpl(`${endpoint}/v1/permission/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license }),
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    return isRemoteBody(body) ? body : undefined
  } catch {
    return undefined
  }
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
