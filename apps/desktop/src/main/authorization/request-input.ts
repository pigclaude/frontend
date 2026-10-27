// 负责解析 renderer 传来的授权请求；非对象、未知用途或模式一律返回 null，未知字段忽略。

import type { AuthorizationRequest } from "./types"

/** 保证只接受 pigclaude-login/claude-account 与 login/register/authorize/switch 组合；switch 仅用于 PigClaude 登录，非字符串字段忽略。 */
export function readAuthorizationRequest(value: unknown): AuthorizationRequest | null {
  if (!isRecord(value)) return null
  const purpose = value.purpose
  const mode = value.mode
  const clientRequestId = readOptionalString(value.clientRequestId)
  if (value.clientRequestId !== undefined && (!clientRequestId || clientRequestId.length > 100))
    return null
  if (
    (purpose !== "pigclaude-login" && purpose !== "claude-account") ||
    (mode !== "login" && mode !== "register" && mode !== "authorize" && mode !== "switch") ||
    (mode === "switch" && purpose !== "pigclaude-login")
  ) {
    return null
  }
  return {
    purpose,
    mode,
    clientRequestId,
    accountName: readOptionalString(value.accountName),
    proxyId: readOptionalString(value.proxyId),
    fingerprintSeed: readOptionalString(value.fingerprintSeed),
    bridgeExit: readOptionalString(value.bridgeExit),
    daemonExit: readOptionalString(value.daemonExit),
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
