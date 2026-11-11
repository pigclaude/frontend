// 定义本机授权环境自检的事实、报告与本次运行请求，不携带代理或 Claude 凭据。

import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { LaunchBrowserNetwork } from "./fingerprint-chromium"

/** 当前必需证据合同的版本；规则变化必须换版。 */
export const environmentPolicyVersion = "pigclaude-auth-environment/profile-1"

/** 与现有授权等待期限一致的报告最长有效时间。 */
export const environmentReportLifetimeMs = 10 * 60 * 1_000

/** 自检项目的固定标识；外部数据不能增加或删除必需项目。 */
export type EnvironmentCheckId =
  | "runtime"
  | "settings"
  | "exit"
  | "proxy-route"
  | "network-policy"
  | "proxy-failure"
  | "webrtc"
  | "claude-navigation"
  | "cli-launch"
  | "cli-protocol"
  | "native-routes"
  | "proxy-dns"
  | "cli-intl"
  | "environment-consistency"
  | "location"
  | "scope"

/** 单项结论；unknown 表示缺证据，info 表示不参与本轮放行。 */
export type EnvironmentCheckState = "passed" | "failed" | "unknown" | "info"

/** 本机计算的单项报告，期望、实际与证据均为可展示的纯文本。 */
export type EnvironmentCheckItem = {
  id: EnvironmentCheckId
  title: string
  critical: boolean
  state: EnvironmentCheckState
  expected: string
  actual: string
  evidence: string
  remedy: string
}

/** 本次授权运行的报告；binding 只在本机核对，不进入脱敏导出。 */
export type EnvironmentCheckReport = {
  policy: typeof environmentPolicyVersion
  runId: string
  binding: string
  createdAt: number
  networkMode: LaunchBrowserNetwork["mode"]
  verdict: "passed" | "blocked" | "incomplete"
  checks: EnvironmentCheckItem[]
}

/** 主进程创建的一次自检请求；回调只接收本次浏览器产生的结果。 */
export type EnvironmentCheckRequest = {
  runId: string
  startedAt: number
  expectedExitIp: string | null
  nativeEvidence?: NativeEnvironmentEvidence | undefined
  browserProfile?: { id: string; revision: number } | undefined
  onReport: (report: EnvironmentCheckReport) => void
}

/** 报告绑定的启动快照，包含本次回调和代理本机入口。 */
export type EnvironmentCheckBindingInput = {
  accountId: string
  fingerprint: ClaudeFingerprintView
  network: LaunchBrowserNetwork
  expectedExitIp: string | null
  nativeBinding?: string | undefined
  nativeEnvironment?: { locale: string; timezone: string } | undefined
  browserProfile?: { id: string; revision: number } | undefined
}

/** 主进程本轮生成的原生证据；绑定与完整快照均不从页面或导出文件导入。 */
export type NativeEnvironmentEvidence = {
  binding: string
  createdAt: number
  exitIp: string | null
  checks: EnvironmentCheckItem[]
  environment?: { locale: string; timezone: string }
}

/** 主进程固定的网络采样目标；仅测试依赖可替换为本机合成目标。 */
export type EnvironmentCheckTargets = {
  primaryIp: string
  secondaryIp: string
  claudeLogin: string
  stun: string
  dnsQuery?: string
}

/** 可信主进程交给实际浏览器的本轮配置和启动参数，不接受页面或 IPC 补写。 */
export type EnvironmentCheckContext = EnvironmentCheckBindingInput & {
  request: EnvironmentCheckRequest
  launchArgs: readonly string[]
}

/** 实际浏览器上下文读取的配置，不用启动参数冒充已经生效。 */
export type BrowserEnvironmentFacts = {
  language: string
  languages: string[]
  locales: string[]
  timezone: string
  expectedTimezone: string
  offsets: number[]
  expectedOffsets: number[]
  platform: string
  hardwareConcurrency: number
}

/** 由 native Network 事件与响应体组成的单次采样。 */
export type NativeEnvironmentResponse = {
  url: string
  frameId: string | null
  loaderId: string | null
  status: number
  body: string
  peerAddress: string | null
  peerPort: number | null
  error: string | null
  fromCache: boolean
  fromServiceWorker: boolean
  secure: boolean
  headers: Record<string, string>
}
