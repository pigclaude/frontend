// 固定自检项目与本次运行的证据合同；未知、缺失或失配报告不能提供授权依据。

import { createHash } from "node:crypto"
import {
  environmentPolicyVersion,
  environmentReportLifetimeMs,
  type EnvironmentCheckBindingInput,
  type EnvironmentCheckId,
  type EnvironmentCheckItem,
  type EnvironmentCheckReport,
  type EnvironmentCheckRequest,
  type EnvironmentCheckState,
} from "./environment-check-model"

const definitions = {
  runtime: ["固定浏览器与实例", "always"],
  settings: ["实际浏览器配置", "always"],
  exit: ["公网 IPv4 出口采样", "always"],
  "proxy-route": ["本次 Xray 连接路径", "bound"],
  "network-policy": ["账号网络参数", "bound"],
  "proxy-failure": ["失效代理演练（独立上下文）", "bound"],
  webrtc: ["WebRTC 公网候选采样", "bound"],
  "claude-navigation": ["Claude 公开页面顶层访问", "always"],
  "cli-launch": ["原生 CLI 与独立启动配置", "always"],
  "cli-protocol": ["原生 CLI 与本机中转协议", "always"],
  "native-routes": ["daemon 与刷新器传输路径", "always"],
  "proxy-dns": ["代理 DNS-over-HTTPS 实际查询", "bound"],
  "cli-intl": ["原生 CLI 内部 Intl 覆盖范围", "never"],
  location: ["同一 IP 的位置资料", "never"],
  scope: ["检测覆盖范围", "never"],
} as const

/** 为启动快照生成本机绑定摘要；摘要不包含在脱敏导出中。 */
export function environmentBinding(input: EnvironmentCheckBindingInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.accountId,
        input.fingerprint,
        input.network.mode,
        input.network.mode === "bound" ? input.network.bridgeUrl : null,
        input.network.mode === "bound" ? input.network.callbackUri : null,
        input.expectedExitIp,
        input.nativeBinding ?? null,
      ]),
    )
    .digest("hex")
}

/** 按固定规则创建单项，critical 属性不取自采样服务或页面。 */
export function environmentCheckItem(
  id: EnvironmentCheckId,
  mode: "system" | "bound",
  state: EnvironmentCheckState,
  values: Pick<EnvironmentCheckItem, "expected" | "actual" | "evidence" | "remedy">,
): EnvironmentCheckItem {
  const [title, rule] = definitions[id]
  return {
    id,
    title,
    critical: rule === "always" || (rule === "bound" && mode === "bound"),
    state,
    ...values,
  }
}

/** 根据必需项目计算结果；失败优先，缺证据保持未完成。 */
export function environmentVerdict(
  checks: readonly EnvironmentCheckItem[],
  mode: "system" | "bound",
): EnvironmentCheckReport["verdict"] {
  const required = Object.entries(definitions).filter(
    ([, [, rule]]) => rule === "always" || (rule === "bound" && mode === "bound"),
  )
  const ids = checks.map((check) => check.id)
  if (new Set(ids).size !== ids.length) return "incomplete"
  if (checks.some((check) => check.critical && check.state === "failed")) return "blocked"
  if (
    required.some(([id]) => {
      const check = checks.find((item) => item.id === id)
      return !check || !check.critical || check.state !== "passed" || check.evidence.trim() === ""
    })
  )
    return "incomplete"
  return "passed"
}

/** 重新核对本轮身份、时间和必需项目，不相信报告自报的 passed。 */
export function acceptsEnvironmentReport(
  report: EnvironmentCheckReport,
  request: Pick<EnvironmentCheckRequest, "runId" | "startedAt">,
  binding: string,
  mode: "system" | "bound",
  now: number,
): boolean {
  if (
    !report ||
    report.policy !== environmentPolicyVersion ||
    report.runId !== request.runId ||
    report.binding !== binding ||
    report.networkMode !== mode ||
    report.verdict !== "passed" ||
    !Number.isFinite(report.createdAt) ||
    report.createdAt < request.startedAt ||
    report.createdAt > now + 5_000 ||
    now - report.createdAt >= environmentReportLifetimeMs ||
    !Array.isArray(report.checks)
  )
    return false
  for (const check of report.checks) {
    if (!check || !Object.hasOwn(definitions, check.id) || typeof check.evidence !== "string")
      return false
    const [, rule] = definitions[check.id]
    const critical = rule === "always" || (rule === "bound" && mode === "bound")
    if (
      check.critical !== critical ||
      !["passed", "failed", "unknown", "info"].includes(check.state)
    )
      return false
  }
  return environmentVerdict(report.checks, mode) === "passed"
}
