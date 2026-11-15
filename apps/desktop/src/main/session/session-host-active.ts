// 负责会话宿主的活动会话：一份会话的全部可变状态，以及把待答队列、权限代理、提问代理、子代理、
// 工作流、回合控制、适配器回调和启动模式装配到这份状态上。

import {
  PendingAnswers,
  type PendingAnswerKind,
  type PendingAnswersOptions,
} from "./pending-answers"
import {
  PermissionBroker,
  type PermissionBrokerOptions,
  type PermissionRequestEvent,
} from "./permission-broker"
import {
  QuestionBroker,
  type QuestionRequestEvent,
  type QuestionResolvedEvent,
} from "./question-broker"
import type { AdapterEvent } from "./session-events"
import type { SessionUsage } from "./session-events"
import { launchPermissionMode } from "./session-host-modes"
import { SessionTurns, type ClosedTurn } from "./session-turns"
import { SubagentTasks } from "./subagent-tasks"
import { WorkflowTasks } from "./workflow-tasks"
import type {
  SessionAdapterFactory,
  SessionAdapterPort,
  SessionEnvironmentPort,
  SessionPermissionMode,
  SessionStartInput,
  SessionTurnEvent,
} from "./session-types"

/** 一个活动会话的全部可变状态；只有 SessionHost 会修改它。 */
export type ActiveSession = {
  sessionId: string
  environment: SessionEnvironmentPort
  adapter: SessionAdapterPort
  /** 权限询问和提问共用的待答队列；整体拒绝和计数都在这里。 */
  pending: PendingAnswers
  broker: PermissionBroker
  questions: QuestionBroker
  /** 这个会话开始过的子代理；权限询问和子代理结束事件据它找回归属。 */
  subagents: SubagentTasks
  /** 这个会话主线程发起的工作流；任务信号据它得出工作流快照。 */
  workflows: WorkflowTasks
  abort: AbortController
  /** 在停止时取消插件工具，独立于 SDK 保存历史后再关闭的退出顺序。 */
  pluginCalls: AbortController
  model: string | null
  permissionMode: SessionPermissionMode
  unconfirmedModes: SessionPermissionMode[]
  accountId: string | null
  /** 启动时偏好的账号；null 表示自动选择。 */
  preferredAccountId: string | null
  switchedFrom: string | null
  turns: SessionTurns
  /** 工作台在一轮前后记检查点；turnId 是这一轮的 id。 */
  checkpoint?:
    ((workspace: string, phase: "baseline" | "final", turnId: string) => Promise<void>) | undefined
  stopping: boolean
  ending: Promise<void> | null
  released: boolean
}

/** 会话用的定时器；测试可以换成假定时器。 */
export type SessionTimers = {
  set: PendingAnswersOptions["setTimer"]
  clear: PendingAnswersOptions["clearTimer"]
}

/** 活动会话回调宿主的入口；待答超时和适配器事件都带上产生它们的那一份会话。 */
export type ActiveSessionHooks = {
  createAdapter: SessionAdapterFactory
  permissionTimeoutMs: number
  timers: SessionTimers
  now: () => number
  usageBaseline?: SessionUsage
  emitPermission: (request: PermissionRequestEvent) => void
  onPermissionSettled: () => void
  emitQuestion: (event: QuestionRequestEvent | QuestionResolvedEvent) => void
  emitTurn: (event: SessionTurnEvent) => void
  onTurnClosed: (active: ActiveSession, turn: ClosedTurn) => void
  /** 权限询问或提问 10 分钟没人回答；kind 是超时的那一种。 */
  onAnswerTimeout: (active: ActiveSession, kind: PendingAnswerKind) => void
  onWaitingChange: (waiting: boolean) => void
  onAdapterEvent: (active: ActiveSession, event: AdapterEvent) => void
} & Pick<PermissionBrokerOptions, "saveProjectGrants">

/** 组装一个活动会话：两个代理共用一个待答队列，代理、回合控制和适配器的回调都指回这一份会话，初始模式是 CLI 的启动模式。 */
export function createActiveSession(
  sessionId: string,
  input: SessionStartInput,
  environment: SessionEnvironmentPort,
  hooks: ActiveSessionHooks,
): ActiveSession {
  const holder: { current: ActiveSession | null } = { current: null }
  const timedOut = (kind: PendingAnswerKind) => (): void => {
    if (holder.current !== null) hooks.onAnswerTimeout(holder.current, kind)
  }
  const pending = new PendingAnswers({
    timeoutMs: hooks.permissionTimeoutMs,
    setTimer: hooks.timers.set,
    clearTimer: hooks.timers.clear,
    onWaitingChange: hooks.onWaitingChange,
  })
  const subagents = new SubagentTasks()
  const broker = new PermissionBroker({
    ...(hooks.saveProjectGrants === undefined
      ? {}
      : { saveProjectGrants: hooks.saveProjectGrants }),
    emit: (request) => hooks.emitPermission({ ...request }),
    onSettled: hooks.onPermissionSettled,
    subagentOf: (agentId) => subagents.refOf(agentId),
    onTimeout: timedOut("permission"),
    queue: pending,
  })
  const questions = new QuestionBroker({
    queue: pending,
    emit: hooks.emitQuestion,
    onTimeout: timedOut("question"),
  })
  const adapter = hooks.createAdapter((event) => {
    if (holder.current !== null) hooks.onAdapterEvent(holder.current, event)
  })
  const active: ActiveSession = {
    sessionId,
    environment,
    adapter,
    pending,
    broker,
    questions,
    subagents,
    workflows: new WorkflowTasks(),
    abort: new AbortController(),
    pluginCalls: new AbortController(),
    model: input.model ?? null,
    permissionMode: launchPermissionMode(input.permissionMode),
    unconfirmedModes: [],
    accountId: input.accountId ?? null,
    preferredAccountId: input.accountId ?? null,
    switchedFrom: null,
    turns: new SessionTurns({
      adapter,
      publish: hooks.emitTurn,
      onClosed: (turn) => {
        if (holder.current !== null) hooks.onTurnClosed(holder.current, turn)
      },
      now: hooks.now,
      timers: hooks.timers,
      ...(hooks.usageBaseline === undefined ? {} : { usageBaseline: hooks.usageBaseline }),
    }),
    stopping: false,
    ending: null,
    released: false,
  }
  holder.current = active
  return active
}
