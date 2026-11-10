// 为授权服务的外部浏览器端口提供明确的合成证据，不用于产品或真实环境判定。

import type { EnvironmentCheckReport, EnvironmentCheckId } from "./environment-check-model"
import { environmentBinding } from "./environment-policy"
import type { LaunchBrowserInput } from "./fingerprint-chromium"

/** 返回符合 v1 合同的合成报告；实际浏览器证据由集成测试采集。 */
export function syntheticEnvironmentReport(input: LaunchBrowserInput): EnvironmentCheckReport {
  const request = input.environmentCheck
  if (!request) throw new Error("合成浏览器没有收到本轮自检请求")
  const boundChecks = ["proxy-route", "network-policy", "proxy-failure", "webrtc"]
  const ids: EnvironmentCheckId[] = [
    "runtime",
    "settings",
    "exit",
    "proxy-route",
    "network-policy",
    "proxy-failure",
    "webrtc",
    "claude-navigation",
  ]
  return {
    policy: "pigclaude-auth-environment/1",
    runId: request.runId,
    createdAt: request.startedAt,
    binding: environmentBinding({ ...input, expectedExitIp: request.expectedExitIp }),
    networkMode: input.network.mode,
    verdict: "passed",
    checks: ids.map((id) => {
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
  }
}
