// 为一次账号授权创建独立的自检绑定，阻止缺证据或旧报告参与换取 Claude 令牌。

import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import type {
  EnvironmentCheckBindingInput,
  EnvironmentCheckReport,
  EnvironmentCheckRequest,
  NativeEnvironmentEvidence,
} from "./environment-check-model"
import { acceptsEnvironmentReport, environmentBinding } from "./environment-policy"
import { ClaudeAccountError } from "./errors"
import type { NativeEnvironmentDiagnostics } from "./native-environment-model"
import { unavailableNativeEvidence } from "./native-environment-evidence"

/** 创建只认可本次启动快照的自检请求与消费屏障。 */
export async function createAuthorizationEnvironmentCheck(
  input: EnvironmentCheckBindingInput & { proxyUrl: string | null; signal: AbortSignal },
  now: () => number,
  diagnostics?: NativeEnvironmentDiagnostics,
): Promise<{ request: EnvironmentCheckRequest; assertApproved: () => void }> {
  input.signal.throwIfAborted()
  const observed =
    diagnostics === undefined
      ? unavailableNativeEvidence(now(), input.network.mode)
      : await diagnostics.inspect({
          accountId: input.accountId,
          fingerprint: input.fingerprint,
          proxyUrl: input.proxyUrl,
          expectedExitIp: input.expectedExitIp,
          startedAt: now(),
          signal: input.signal,
        })
  input.signal.throwIfAborted()
  const runId = randomUUID()
  const startedAt = now()
  const native: NativeEnvironmentEvidence = structuredClone(observed)
  const binding = environmentBinding({ ...input, nativeBinding: native?.binding })
  let latest: EnvironmentCheckReport | undefined
  const request: EnvironmentCheckRequest = {
    runId,
    startedAt,
    expectedExitIp: input.expectedExitIp,
    nativeEvidence: structuredClone(native),
    onReport: (report) => {
      latest = structuredClone(report)
    },
  }
  return {
    request,
    assertApproved: () => {
      if (
        !latest ||
        !native ||
        !Number.isFinite(native.createdAt) ||
        native.createdAt > now() + 5_000 ||
        now() - native.createdAt >= 10 * 60 * 1_000 ||
        native.checks.some(
          (expected) =>
            !isDeepStrictEqual(
              latest?.checks.find((item) => item.id === expected.id),
              expected,
            ),
        ) ||
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
