// 定义原生 CLI 与本机传输诊断的外部端口，代理凭据只在可信主进程内使用。

import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { NativeEnvironmentEvidence } from "./environment-check-model"

/** 一次原生诊断的账号快照；不从 renderer 接受检测地址或真实 OAuth 凭据。 */
export type NativeEnvironmentInput = {
  accountId: string
  fingerprint: ClaudeFingerprintView
  proxyUrl: string | null
  expectedExitIp: string | null
  startedAt: number
  signal: AbortSignal
}

/** 原生进程与网络边界的诊断端口；未确认清理时必须阻止下一次诊断。 */
export type NativeEnvironmentDiagnostics = {
  inspect: (input: NativeEnvironmentInput) => Promise<NativeEnvironmentEvidence>
  settle?: () => Promise<void>
  dispose: () => Promise<void>
}
