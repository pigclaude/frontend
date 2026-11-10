// 固定原生诊断的必需项目与缺证据结果，生成仅供主进程使用的本轮绑定。

import { createHash, randomUUID } from "node:crypto"
import type { EnvironmentCheckItem, NativeEnvironmentEvidence } from "./environment-check-model"
import { environmentCheckItem } from "./environment-policy"

/** 把本轮原生结果绑定为不可跨运行复用的证据，不向导出提供绑定摘要。 */
export function createNativeEvidence(
  checks: EnvironmentCheckItem[],
  createdAt: number,
  exitIp: string | null,
): NativeEnvironmentEvidence {
  const binding = createHash("sha256")
    .update(JSON.stringify([randomUUID(), createdAt, exitIp, checks]))
    .digest("hex")
  return { binding, createdAt, exitIp, checks }
}

/** 未接入诊断端口时明确显示未知，不把原有浏览器报告当成新增项目通过。 */
export function unavailableNativeEvidence(
  now: number,
  mode: "bound" | "system",
): NativeEnvironmentEvidence {
  const checks = (["cli-launch", "cli-protocol", "native-routes"] as const).map((id) =>
    environmentCheckItem(id, mode, "unknown", {
      expected: "本次运行的实际原生诊断证据",
      actual: "原生诊断端口未接入",
      evidence: "主进程未取得本轮 native 检测结果",
      remedy: "准备官方 CLI 与本机中转组件后重新检测",
    }),
  )
  return createNativeEvidence(checks, now, null)
}
