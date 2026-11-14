// 负责把 preload 会话桥接到界面控制器：订阅事件信封、维护会话模型、加载模型探针，
// 并把命令带上会话 id 转发。页面只消费这个控制器，不直接调用 window.pigclaude。

import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type {
  ClaudeModel,
  SessionBridge,
  SessionSendOptions,
  SessionStartInput,
  SessionStatusView,
} from "../../../main/session/session-types"
import { needsSessionResume, type SavedSessionSummary } from "../models/saved-session"
import { timelineNotice } from "../../../main/session/session-notice"
import {
  reduceSessionCollection,
  refreshesSessionList,
  sessionState,
  type SessionCollection,
} from "../models/session-collection"
import { SessionEnvelopeIntake } from "../models/session-envelope-intake"
import { sessionErrorView, type SessionErrorView } from "../models/session-errors"
import { sessionErrorText, type SessionAction, type SessionUiState } from "../models/session-model"
import { sessionErrorFrom } from "../models/session-errors"

/** 聊天页和环境页共用的会话控制器。 */
export type SessionController = {
  state: SessionUiState
  /** 各会话的状态按 id 保存，切换选择时保留后台会话的回合。 */
  states: SessionCollection
  /** 主进程的活动会话和停放会话摘要。 */
  summaries: readonly SavedSessionSummary[]
  /** 磁盘已删除的会话 id 和项目，覆盖当前窗口中可能保留的旧导航。 */
  removedSessions: ReadonlyMap<string, string>
  /** 这次窗口收到的最新提示，包括后台会话和宿主的文字通知。 */
  notice: SessionUiState["notice"]
  status: SessionStatusView | null
  models: ClaudeModel[]
  modelsLoading: boolean
  modelsError: string | null
  /** Claude Code 没有列出模型的原因；这时 models 是主进程给的内置目录。 */
  modelsCliError: string | null
  start: (input: SessionStartInput, onError?: (message: string) => void) => Promise<boolean>
  /** 用选定的设置发送；已归档目标可带摘要，失败时保留草稿。 */
  send: (
    text: string,
    options?: SessionSendOptions,
    target?: string | SavedSessionSummary,
    onError?: (error: SessionErrorView) => void,
  ) => Promise<boolean>
  cancel: () => Promise<void>
  stop: () => Promise<void>
  /** updatedPermissions 是“始终允许”要写回的 SDK 规则；只允许一次时省略。 */
  respondPermission: (
    requestId: string,
    decision: "allow" | "deny",
    updatedPermissions?: unknown[],
  ) => Promise<void>
  /** 回答一次提问；answers 每个问题一条，提问卡等主进程发来结束事件后才换成历史行。 */
  answerQuestion: (requestId: string, answers: string[]) => Promise<void>
  /** 请求切换权限模式；界面上的模式只在主进程广播后才变。 */
  setMode: (mode: SessionUiState["permissionMode"]) => Promise<void>
  setModel: (model: string) => Promise<void>
  /** force 为 true 时忽略缓存重新查询；成功一次后默认不重复启动 CLI。 */
  refreshModels: (force?: boolean) => Promise<void>
  /** 放弃当前模型查询等待；迟到结果不会再写入状态。 */
  cancelModels: () => void
  refreshStatus: () => Promise<void>
  /** 刷新未归档摘要，无需触动会话或时间线。 */
  refreshSummaries: () => Promise<void>
  clearError: () => void
}

const modelsTimeoutMs = 20_000
const notStarted = "SDK_ERROR: 会话未开始"

function now(): string {
  return new Date().toISOString()
}

/**
 * 订阅全部会话事件。selection 指定当前会话，null 表示草稿，省略时可从信封发现当前会话。
 * 传入 null 桌面桥时，所有命令都会给出可读错误。
 */
export function useSession(
  bridge?: SessionBridge | null,
  selection?: string | null,
): SessionController {
  const resolved = bridge === undefined ? window.pigclaude?.session : bridge
  const [states, dispatch] = useReducer(reduceSessionCollection, new Map())
  const [summaries, setSummaries] = useState<readonly SavedSessionSummary[]>([])
  const [removedSessions, setRemovedSessions] = useState<ReadonlyMap<string, string>>(new Map())
  const [notice, setNotice] = useState<SessionUiState["notice"]>(null)
  const [status, setStatus] = useState<SessionStatusView | null>(null)
  const [models, setModels] = useState<ClaudeModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsCliError, setModelsCliError] = useState<string | null>(null)
  const turnSeq = useRef(0)
  const activeTurns = useRef(new Map<string, string>())
  const [discovered, setDiscovered] = useState<string | null>(null)
  const targetRef = useRef<string | null>(null)
  const route = useRef(selection)
  const intakeRef = useRef<SessionEnvelopeIntake | null>(null)
  const startingRef = useRef<Promise<string | null> | null>(null)
  const listRevision = useRef(0)
  const statusRevision = useRef(0)
  const modelsLoaded = useRef(false)
  const modelsLoadingRef = useRef(false)
  const modelsRequest = useRef(0)

  route.current = selection
  if (selection !== undefined) targetRef.current = selection
  const selected = selection === undefined ? discovered : selection
  const historySelection = selection === undefined ? summaries[0]?.sessionId : selection
  const current = sessionState(states, selected)
  const state =
    current.started || current.ended || selected === null || status?.sessionId !== selected
      ? current
      : {
          ...current,
          started: status.active,
          model: current.model ?? status.model,
          accountId: current.accountId ?? status.accountId,
          permissionMode: status.permissionMode,
        }
  const commandTarget = useCallback(
    () => (selection === undefined ? targetRef.current : selection),
    [selection],
  )
  const apply = useCallback((sessionId: string | null, action: SessionAction): void => {
    dispatch({ sessionId, action })
  }, [])

  const refreshSummaries = useCallback(async () => {
    if (!resolved?.list) return
    const revision = ++listRevision.current
    try {
      const result = await resolved.list()
      if (listRevision.current !== revision) return
      setSummaries(result)
      if (route.current === undefined && targetRef.current === null) {
        const id = result[0]?.sessionId
        if (id !== undefined) {
          targetRef.current = id
          setDiscovered(id)
        }
      }
    } catch {
      // 会员关停和宿主替换期间保留最后收到的摘要。
    }
  }, [resolved])

  const refreshStatus = useCallback(async () => {
    if (resolved === null || resolved === undefined) return
    const sessionId = targetRef.current
    const revision = ++statusRevision.current
    try {
      const next = await (sessionId === null ? resolved.status() : resolved.status({ sessionId }))
      if (statusRevision.current === revision) setStatus(next)
    } catch {
      if (statusRevision.current === revision) setStatus(null)
    }
  }, [resolved])

  const refreshModels = useCallback(
    async (force = false) => {
      if (resolved === null || resolved === undefined) {
        setModelsError("桌面会话服务不可用")
        return
      }
      if (modelsLoadingRef.current) return
      if (modelsLoaded.current && !force) return
      const request = ++modelsRequest.current
      modelsLoadingRef.current = true
      setModelsLoading(true)
      setModelsError(null)
      setModelsCliError(null)
      const timer = setTimeout(() => {
        if (request !== modelsRequest.current) return
        modelsRequest.current += 1
        modelsLoadingRef.current = false
        setModelsLoading(false)
        setModelsError("模型查询超时，请重试")
      }, modelsTimeoutMs)
      try {
        const catalog = await resolved.models()
        if (request !== modelsRequest.current) return
        modelsLoaded.current = true
        setModels(catalog.models)
        setModelsCliError(catalog.cliError === null ? null : sessionErrorText(catalog.cliError))
      } catch (error: unknown) {
        if (request !== modelsRequest.current) return
        setModels([])
        setModelsError(sessionErrorText(sessionErrorFrom(error) || "SDK_ERROR: 模型列表加载失败"))
      } finally {
        clearTimeout(timer)
        if (request === modelsRequest.current) {
          modelsLoadingRef.current = false
          setModelsLoading(false)
        }
      }
    },
    [resolved],
  )

  const cancelModels = useCallback(() => {
    if (!modelsLoadingRef.current) return
    modelsRequest.current += 1
    modelsLoadingRef.current = false
    setModelsLoading(false)
    setModelsError("已取消模型查询")
  }, [])

  useEffect(() => {
    if (resolved === null || resolved === undefined) return
    const intake = new SessionEnvelopeIntake({
      fetch: (sessionId, afterSeq) => resolved.events({ sessionId, afterSeq }),
      apply: (envelope, replay = false) => {
        const { sessionId, event } = envelope
        if (event.type === "sessions-changed" && event.removed) {
          const { sessionId, projectPath } = event.removed
          intake.forget(sessionId)
          activeTurns.current.delete(sessionId)
          dispatch({ removed: sessionId })
          setRemovedSessions((current) => new Map(current).set(sessionId, projectPath))
        }
        if (
          !replay &&
          event.type === "notice" &&
          "message" in event &&
          timelineNotice(event) === null
        ) {
          setNotice({ message: event.message })
        }
        if (sessionId === null && event.type === "error") {
          setNotice({ message: sessionErrorText(`${event.code}: ${event.message}`) })
        }
        if (targetRef.current === null && sessionId !== null && route.current === undefined) {
          targetRef.current = sessionId
          setDiscovered(sessionId)
        }
        if (
          !replay &&
          sessionId !== null &&
          (event.type === "turn-ended" || event.type === "ended")
        ) {
          activeTurns.current.delete(sessionId)
        }
        if (event.type !== "sessions-changed") apply(sessionId, { type: "envelope", envelope })
        if (!replay && refreshesSessionList(envelope)) void refreshSummaries()
      },
    })
    intakeRef.current = intake
    const unsubscribe = resolved.subscribe((envelope) => intake.receive(envelope))
    void refreshSummaries()
    return () => {
      intake.close()
      intakeRef.current = null
      unsubscribe()
      listRevision.current += 1
    }
  }, [apply, refreshSummaries, resolved])

  useEffect(() => {
    void refreshStatus()
  }, [selection, refreshStatus])

  useEffect(() => {
    if (historySelection && resolved?.events) void intakeRef.current?.catchUp(historySelection)
  }, [resolved, historySelection])

  const start = useCallback(
    async (input: SessionStartInput, onError?: (message: string) => void): Promise<boolean> => {
      const pendingId = input.sessionId ?? null
      const automatic = route.current === undefined
      if (!automatic && pendingId === null) {
        onError?.(sessionErrorText(notStarted))
        return false
      }
      if (resolved === null || resolved === undefined) {
        const message = "桌面会话服务不可用"
        apply(pendingId, { type: "failed", message, at: now() })
        onError?.(message)
        return false
      }
      apply(pendingId, { type: "starting" })
      if (automatic) {
        targetRef.current = pendingId
        setDiscovered(pendingId)
      }
      const pending = resolved.start(input)
      if (automatic) {
        startingRef.current = pending.then(
          (result) => result.sessionId,
          () => null,
        )
      }
      try {
        const result = await pending
        intakeRef.current?.startedHere(result.sessionId)
        if (automatic) {
          targetRef.current = result.sessionId
          setDiscovered(result.sessionId)
          void refreshStatus()
        }
        apply(result.sessionId, { type: "opened", sessionId: result.sessionId })
        void refreshSummaries()
        return true
      } catch (error: unknown) {
        const message = sessionErrorFrom(error)
        apply(pendingId, { type: "failed", message, at: now() })
        onError?.(sessionErrorText(message))
        void refreshSummaries()
        return false
      }
    },
    [apply, refreshStatus, refreshSummaries, resolved],
  )

  const send = useCallback(
    async (
      text: string,
      options?: SessionSendOptions,
      target?: string | SavedSessionSummary,
      onError?: (error: SessionErrorView) => void,
    ): Promise<boolean> => {
      const sessionId = typeof target === "object" ? target.sessionId : (target ?? commandTarget())
      if (resolved === null || resolved === undefined) {
        apply(sessionId, { type: "failed", message: "桌面会话服务不可用", at: now() })
        return false
      }
      // 当前 turn 未结束时拒绝第二次发送，避免为一个 turn 建两条用户消息。
      if (sessionId === null) {
        apply(null, { type: "failed", message: notStarted, at: now() })
        return false
      }
      if (historySelection === sessionId && intakeRef.current?.isCatchingUp(sessionId)) return false
      const summary =
        typeof target === "object" ? target : summaries.find((item) => item.sessionId === sessionId)
      if (summary?.restorable === true && !intakeRef.current?.hasHistory(sessionId)) {
        void intakeRef.current?.catchUp(sessionId)
        return false
      }
      if (activeTurns.current.has(sessionId)) return false
      turnSeq.current += 1
      const turnId = `turn-${turnSeq.current}`
      activeTurns.current.set(sessionId, turnId)
      apply(sessionId, { type: "user-message", text, turnId, at: now() })
      try {
        await resolved.send({ ...options, sessionId, text })
        return true
      } catch (error: unknown) {
        const message = sessionErrorFrom(error)
        if (activeTurns.current.get(sessionId) === turnId) {
          activeTurns.current.delete(sessionId)
          if (needsSessionResume(summary))
            apply(sessionId, { type: "resume-failed", message, at: now(), turnId })
          else apply(sessionId, { type: "failed", message, at: now() })
        }
        onError?.(sessionErrorView(message))
        return false
      }
    },
    [apply, commandTarget, historySelection, resolved, summaries],
  )

  const cancel = useCallback(async (): Promise<void> => {
    const sessionId = commandTarget()
    apply(sessionId, { type: "cancel-requested", at: now() })
    if (sessionId === null) return
    try {
      await resolved?.cancel({ sessionId })
    } catch (error: unknown) {
      apply(sessionId, { type: "failed", message: sessionErrorFrom(error), at: now() })
    }
  }, [apply, commandTarget, resolved])

  const stop = useCallback(async (): Promise<void> => {
    const sessionId =
      commandTarget() ?? (selection === undefined ? await startingRef.current : null)
    try {
      if (sessionId !== null) await resolved?.stop({ sessionId })
    } catch (error: unknown) {
      apply(sessionId, { type: "failed", message: sessionErrorFrom(error), at: now() })
      return
    }
    if (sessionId !== null) activeTurns.current.delete(sessionId)
    apply(sessionId, { type: "stopped", at: now() })
    void refreshStatus()
    void refreshSummaries()
  }, [apply, commandTarget, refreshStatus, refreshSummaries, resolved, selection])

  const respondPermission = useCallback(
    async (
      requestId: string,
      decision: "allow" | "deny",
      updatedPermissions?: unknown[],
    ): Promise<void> => {
      const sessionId = commandTarget()
      if (sessionId === null) return
      apply(sessionId, { type: "permission-answered", requestId, decision, at: now() })
      try {
        await resolved?.respondPermission({
          sessionId,
          requestId,
          decision,
          ...(updatedPermissions === undefined || updatedPermissions.length === 0
            ? {}
            : { updatedPermissions }),
        })
      } catch (error: unknown) {
        apply(sessionId, { type: "failed", message: sessionErrorFrom(error), at: now() })
      } finally {
        void refreshSummaries()
      }
    },
    [apply, commandTarget, refreshSummaries, resolved],
  )

  const answerQuestion = useCallback(
    async (requestId: string, answers: string[]): Promise<void> => {
      const sessionId = commandTarget()
      if (sessionId === null) return
      try {
        await resolved?.answerQuestion({ sessionId, requestId, answers })
      } catch (error: unknown) {
        apply(sessionId, { type: "failed", message: sessionErrorFrom(error), at: now() })
      }
    },
    [apply, commandTarget, resolved],
  )

  const setMode = useCallback(
    async (mode: SessionUiState["permissionMode"]): Promise<void> => {
      const sessionId = commandTarget()
      if (sessionId === null) return
      try {
        await resolved?.setMode({ sessionId, mode })
      } catch (error: unknown) {
        apply(sessionId, { type: "failed", message: sessionErrorFrom(error), at: now() })
      }
    },
    [apply, commandTarget, resolved],
  )

  const setModel = useCallback(
    async (model: string): Promise<void> => {
      const sessionId = commandTarget()
      apply(sessionId, { type: "model-changed", model })
      if (sessionId === null) return
      try {
        await resolved?.setModel({ sessionId, model })
      } catch (error: unknown) {
        apply(sessionId, { type: "failed", message: sessionErrorFrom(error), at: now() })
      }
    },
    [apply, commandTarget, resolved],
  )

  const clearError = useCallback(
    () => apply(commandTarget(), { type: "clear-error" }),
    [apply, commandTarget],
  )

  return {
    state,
    states,
    summaries,
    removedSessions,
    notice,
    status:
      selection === undefined || selected === null || status?.sessionId === selected
        ? status
        : null,
    models,
    modelsLoading,
    modelsError,
    modelsCliError,
    start,
    send,
    cancel,
    stop,
    respondPermission,
    answerQuestion,
    setMode,
    setModel,
    refreshModels,
    cancelModels,
    refreshStatus,
    refreshSummaries,
    clearError,
  }
}

/** 会话正在用的账号：先取换号事件记下的账号，再取主进程状态；都不知道时返回 null。 */
export function sessionAccountId(
  session: Pick<SessionController, "state" | "status">,
): string | null {
  return session.state.accountId ?? session.status?.accountId ?? null
}
