// 负责把 daemon 返回的已知失败标记映射成会话错误码；只做四个固定标记的有界匹配。

import type { SessionErrorCode } from "./session-types"

const daemonMarkers: ReadonlyArray<readonly [string, SessionErrorCode]> = [
  ["no_available_account", "NO_AVAILABLE_ACCOUNT"],
  ["proxy_unavailable", "PROXY_UNAVAILABLE"],
  ["upstream_unavailable", "NETWORK_UNAVAILABLE"],
  ["auth_expired", "AUTH_EXPIRED"],
]

/** 保证只在错误文本包含 daemon 的四个已知标记时返回对应会话错误码，否则返回 null。 */
export function classifyDaemonError(message: string): SessionErrorCode | null {
  const value = message.toLowerCase()
  for (const [marker, code] of daemonMarkers) {
    if (value.includes(marker)) return code
  }
  return null
}
