// 解析原始 IPv4 探针，不把私网、文档网段或服务错误正文当成公网出口。

import { isIP } from "node:net"

/** 仅接受可用于本期公网出口比对的 IPv4 单播地址。 */
export function publicEnvironmentIpv4(value: unknown): string | null {
  if (typeof value !== "string" || isIP(value.trim()) !== 4) return null
  const ip = value.trim()
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number)
  if (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  )
    return null
  return ip
}

/** 从原始纯文本或 caller-IP JSON 读取地址，不推断服务端或其他目标的 IP。 */
export function environmentResponseIp(body: string): string | null {
  const plain = publicEnvironmentIpv4(body)
  if (plain) return plain
  try {
    const value: unknown = JSON.parse(body)
    if (value && typeof value === "object" && "ip" in value) return publicEnvironmentIpv4(value.ip)
  } catch {
    /* 非 JSON 或无效正文没有出口证据。 */
  }
  return null
}
