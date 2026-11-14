// 负责会话宿主的活动会话：一份会话的全部可变状态，以及把权限代理、回合控制、适配器回调和启动模式装配到这份状态上。

import {
  PermissionBroker,
  type PermissionBrokerOptions,
  type PermissionRequestEvent,
} from "./permission-broker"
import type { AdapterEvent } from "./session-events"
import { launchPermissionMode } from "./session-host-modes"
import { SessionTurns, type ClosedTurn } from "./session-turns"
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
  broker: PermissionBroker
  abort: AbortController
  model: string | null
  permissionMode: SessionPermissionMode
  unconfirmedModes: SessionPermissionMode[]
  accountId: string | null
  /** 启动时偏好的账号；null 表示自动选择。 */
  preferredAccountId: string | null
  switchedFrom: string | null
  turns: SessionTurns
  checkpoint?: ((workspace: string, phase: "baseline" | "final") => Promise<void>) | undefined
  stopping: boolean
  ending: Promise<void> | null
  released: boolean
}

/** 会话用的定时器；测试可以换成假定时器。 */
export type SessionTimers = {
  set: NonNullable<PermissionBrokerOptions["setTimer"]>
  clear: NonNullable<PermissionBrokerOptions["clearTimer"]>
}

/** 活动会话回调宿主的入口；权限超时和适配器事件都带上产生它们的那一份会话。 */
export type ActiveSessionHooks = {
  createAdapter: SessionAdapterFactory
  permissionTimeoutMs: number
  timers: SessionTimers
  now: () => number
  emitPermission: (request: PermissionRequestEvent) => void
  emitTurn: (event: SessionTurnEvent) => void
  onTurnClosed: (active: ActiveSession, turn: ClosedTurn) => void
  onPermissionTimeout: (active: ActiveSession) => void
  onAdapterEvent: (active: ActiveSession, event: AdapterEvent) => void
}

/** 组装一个活动会话：权限代理、回合控制和适配器的回调都指回这一份会话，初始模式是 CLI 的启动模式。 */
export function createActiveSession(
  sessionId: string,
  input: SessionStartInput,
  environment: SessionEnvironmentPort,
  hooks: ActiveSessionHooks,
): ActiveSession {
  const holder: { current: ActiveSession | null } = { current: null }
  const broker = new PermissionBroker({
    emit: (request) => hooks.emitPermission({ ...request }),
    onTimeout: () => {
      if (holder.current !== null) hooks.onPermissionTimeout(holder.current)
    },
    timeoutMs: hooks.permissionTimeoutMs,
    setTimer: hooks.timers.set,
    clearTimer: hooks.timers.clear,
  })
  const adapter = hooks.createAdapter((event) => {
    if (holder.current !== null) hooks.onAdapterEvent(holder.current, event)
  })
  const active: ActiveSession = {
    sessionId,
    environment,
    adapter,
    broker,
    abort: new AbortController(),
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
    }),
    stopping: false,
    ending: null,
    released: false,
  }
  holder.current = active
  return active
}
