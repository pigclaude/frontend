// 为一次账号授权创建独立的自检绑定，阻止缺证据或旧报告参与换取 Claude 令牌。

import { randomUUID } from "node:crypto"
import type {
  EnvironmentCheckBindingInput,
  EnvironmentCheckReport,
  EnvironmentCheckRequest,
} from "./environment-check-model"
import { acceptsEnvironmentReport, environmentBinding } from "./environment-policy"
import { ClaudeAccountError } from "./errors"

/** 创建只认可本次启动快照的自检请求与消费屏障。 */
export function createAuthorizationEnvironmentCheck(
  input: EnvironmentCheckBindingInput,
  now: () => number,
): { request: EnvironmentCheckRequest; assertApproved: () => void } {
  const runId = randomUUID()
  const startedAt = now()
  const binding = environmentBinding(input)
  let latest: EnvironmentCheckReport | undefined
  const request: EnvironmentCheckRequest = {
    runId,
    startedAt,
    expectedExitIp: input.expectedExitIp,
    onReport: (report) => {
      latest = structuredClone(report)
    },
  }
  return {
    request,
    assertApproved: () => {
      if (
        !latest ||
        !acceptsEnvironmentReport(latest, { runId, startedAt }, binding, input.network.mode, now())
      ) {
        throw new ClaudeAccountError(
          "ENVIRONMENT_CHECK_FAILED",
          "本次授权缺少完整通过的环境自检证据",
        )
      }
    },
  }
}
