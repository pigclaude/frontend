// 定义账号服务访问外部浏览器、OAuth、代理和本机存储的依赖端口。

import type { ClaudeAccountEvent } from "@pigclaude/contracts/claude-account"
import type { LocalStore } from "@pigclaude/local-store"
import type { EgressResult } from "@pigclaude/login-gate/egress-check"
import type { StartProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import type { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import type { SubscriptionOAuth } from "./subscription-oauth"
import type { ClaudeCliCredential } from "./cli-credential-reader"
import type { ClaudeCliAccountMetadata } from "./cli-account-metadata"
import type { NativeEnvironmentDiagnostics } from "./native-environment-model"

/** 账号服务依赖。所有外部副作用都通过端口注入。 */
export type ClaudeAccountServiceDeps = {
  store: LocalStore
  browser: Pick<
    FingerprintChromiumAdapter,
    "ensureAvailable" | "launch" | "deleteProfile" | "profileDir" | "dispose"
  >
  oauth: Pick<
    SubscriptionOAuth,
    "buildAuthorizeUrl" | "startCallback" | "exchangeCode" | "readProfile"
  >
  /** 提供已接入的外部代理核心；未提供时，绑定代理授权保持不可用。 */
  startProxyRuntime?: StartProxyRuntime
  checkEgress: (input: {
    bridgeUrl: string
    upstreamProxyUrl: string
    checkUrl: string
    signal?: AbortSignal
  }) => Promise<EgressResult>
  ensureMembership: () => Promise<void>
  /** 原生诊断只使用合成请求与固定出口查询，不使用真实 Claude 凭据。 */
  nativeDiagnostics?: NativeEnvironmentDiagnostics
  /** 读取 Claude CLI Keychain 凭据；测试注入假实现，避免访问真实钥匙串。 */
  readCliCredential?: () => Promise<ClaudeCliCredential>
  /** 读取 Claude CLI 的 oauthAccount 元数据；返回 null 表示文件缺失或不可读。 */
  readCliAccountMetadata?: () => Promise<ClaudeCliAccountMetadata | null>
  egressCheckUrl?: string
  now?: () => number
  id?: () => string
  onEvent?: (event: ClaudeAccountEvent) => void
}
