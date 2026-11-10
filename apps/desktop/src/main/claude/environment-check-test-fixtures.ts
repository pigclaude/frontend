// 为授权服务的外部浏览器端口提供明确的合成证据，不用于产品或真实环境判定。

import type {
  EnvironmentCheckReport,
  EnvironmentCheckId,
  NativeEnvironmentEvidence,
  EnvironmentCheckItem,
} from "./environment-check-model"
import { environmentBinding } from "./environment-policy"
import type { LaunchBrowserInput } from "./fingerprint-chromium"

/** 返回当前合同的合成报告；原生端口的结果明确来自本轮合成依赖。 */
export function syntheticEnvironmentReport(input: LaunchBrowserInput): EnvironmentCheckReport {
  const request = input.environmentCheck
  if (!request) throw new Error("合成浏览器没有收到本轮自检请求")
  const boundChecks = ["proxy-route", "network-policy", "proxy-failure", "webrtc", "proxy-dns"]
  const ids: EnvironmentCheckId[] = [
    "runtime",
    "settings",
    "exit",
    "proxy-route",
    "network-policy",
    "proxy-failure",
    "webrtc",
    "claude-navigation",
    "proxy-dns",
    "environment-consistency",
  ]
  return {
    policy: "pigclaude-auth-environment/profile-1",
    runId: request.runId,
    createdAt: request.startedAt,
    binding: environmentBinding({
      ...input,
      expectedExitIp: request.expectedExitIp,
      nativeBinding: request.nativeEvidence?.binding,
      nativeEnvironment: request.nativeEvidence?.environment,
      browserProfile: request.browserProfile,
    }),
    networkMode: input.network.mode,
    verdict: "passed",
    checks: [
      ...ids.map((id): EnvironmentCheckItem => {
        const critical = !boundChecks.includes(id) || input.network.mode === "bound"
        return {
          id,
          title: id,
          critical,
          state: critical ? "passed" : "info",
          expected: "合成基线",
          actual: "合成观测",
          evidence: "外部浏览器端口的预设测试结果",
          remedy: "",
        }
      }),
      ...structuredClone(request.nativeEvidence?.checks ?? []),
    ],
  }
}

/** 为服务测试的外部 native 端口提供固定合成结果，不代表真实 CLI 已运行。 */
export function syntheticNativeEvidence(
  createdAt: number,
  mode: "bound" | "system",
  exitIp: string | null,
  environment = { locale: "en-US", timezone: "America/Los_Angeles" },
): NativeEnvironmentEvidence {
  return {
    binding: "synthetic-native-port",
    createdAt,
    exitIp,
    environment,
    checks: (["cli-launch", "cli-protocol", "native-routes"] as const).map((id) => ({
      id,
      title: id,
      critical: true,
      state: "passed",
      expected: "合成原生端口",
      actual: "合成观测",
      evidence: `明确的外部 native 端口合成结果；${mode}`,
      remedy: "",
    })),
  }
}
