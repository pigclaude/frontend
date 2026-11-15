// 执行定时会话的首个回合，并从现场信封收集结果、账号和通知来源。

import { randomUUID } from "node:crypto"
import type { ScheduledTaskInput, ScheduledTaskOutcome } from "../../scheduled-tasks-contract"
import { SessionSlotTimeout } from "./session-concurrency"
import type { SessionHost } from "./session-host"
import { SessionHostError, type SessionStatusView, type SessionTurnEvent } from "./session-types"

/** 只附在新定时会话的启动上，不写入可续接的 SDK 策略。 */
export type ScheduledLaunch = {
  signal: AbortSignal
  denied(): void
}

/** 现场信封已经经过普通会话通知通道时，标记这一次运行。 */
export type ScheduledHostOutcome = ScheduledTaskOutcome & { sessionNoticeHandled?: true }

type Ports = {
  host: Pick<SessionHost, "start" | "stop" | "status" | "subscribe">
  active: Set<string>
  send(sessionId: string, text: string): Promise<void>
}

const stopped: ScheduledTaskOutcome = { status: "stopped", reason: "APP_STOPPED" }
const failed: ScheduledTaskOutcome = { status: "failed", reason: "SDK_ERROR" }
const skipCodes = new Set([
  "MEMBERSHIP_REQUIRED",
  "WORKSPACE_UNAVAILABLE",
  "NO_AVAILABLE_ACCOUNT",
  "DAEMON_UNAVAILABLE",
  "SESSION_LIMIT_REACHED",
])

/** 新建一个只属于这次运行的会话，等首轮结束后通过宿主原有路径停放。 */
export async function executeScheduledTurn(
  { host, active, send }: Ports,
  task: ScheduledTaskInput,
  signal: AbortSignal,
): Promise<ScheduledHostOutcome> {
  if (signal.aborted) return stopped

  const sessionId = randomUUID()
  let deniedApprovals = 0
  let actualAccountId: string | null = null
  let sessionNoticeHandled = false
  let terminal: ScheduledTaskOutcome | undefined
  let finish: (outcome: ScheduledTaskOutcome) => void = () => undefined
  const ended = new Promise<ScheduledTaskOutcome>((resolve) => {
    finish = (outcome) => {
      terminal ??= outcome
      resolve(terminal)
    }
  })
  const unsubscribe = host.subscribe(({ sessionId: id, event }) => {
    if (id !== sessionId) return
    if (event.type === "account-switched") actualAccountId = event.to
    if (event.type === "turn-ended") {
      sessionNoticeHandled = true
      finish(turnOutcome(event))
    } else if (event.type === "ended") {
      if (event.reason === "error") sessionNoticeHandled = true
      finish(event.reason === "stopped" ? stopped : failed)
    }
  })
  let parking: Promise<void> | undefined
  const park = () => (parking ??= host.stop(sessionId))
  const abort = () => {
    finish(stopped)
    void park().catch(() => undefined)
  }
  active.add(sessionId)
  signal.addEventListener("abort", abort, { once: true })
  try {
    let outcome: ScheduledTaskOutcome
    try {
      await host.start(
        {
          sessionId,
          workspace: task.projectPath,
          projectPath: task.projectPath,
          permissionMode: task.permissionMode,
          ...(task.model === null ? {} : { model: task.model }),
          ...(task.accountId === null ? {} : { accountId: task.accountId }),
        },
        undefined,
        {
          signal,
          denied: () => {
            deniedApprovals += 1
          },
        },
      )
      if (terminal === undefined && !signal.aborted) await send(sessionId, task.prompt)
      outcome = await ended
    } catch (error) {
      outcome = terminal ?? (signal.aborted ? stopped : startOrSendFailure(error))
    }
    try {
      await park()
    } catch {
      outcome = { status: "failed", reason: "SESSION_STOP_FAILED" }
      sessionNoticeHandled = false
    }
    const snapshot = savedOrLiveStatus(host, sessionId)
    return {
      ...outcome,
      sessionId: snapshot === null ? null : sessionId,
      accountId: actualAccountId ?? snapshot?.accountId ?? null,
      deniedApprovals,
      ...(sessionNoticeHandled ? { sessionNoticeHandled: true } : {}),
    }
  } finally {
    signal.removeEventListener("abort", abort)
    unsubscribe()
    active.delete(sessionId)
  }
}

function savedOrLiveStatus(
  host: Pick<SessionHost, "status">,
  sessionId: string,
): SessionStatusView | null {
  try {
    return host.status(sessionId)
  } catch {
    return null
  }
}

function turnOutcome(
  event: Extract<SessionTurnEvent, { type: "turn-ended" }>,
): ScheduledTaskOutcome {
  if (event.status === "completed") return { status: "succeeded" }
  if (event.status === "interrupted") return { status: "stopped", reason: event.errorCode }
  return { status: "failed", reason: event.errorCode ?? "SDK_ERROR" }
}

function startOrSendFailure(error: unknown): ScheduledTaskOutcome {
  if (error instanceof SessionSlotTimeout)
    return { status: "skipped", reason: "CONCURRENCY_TIMEOUT" }
  if (error instanceof SessionHostError) {
    if (error.code === "SESSION_CANCELLED") return stopped
    return { status: skipCodes.has(error.code) ? "skipped" : "failed", reason: error.code }
  }
  return failed
}
