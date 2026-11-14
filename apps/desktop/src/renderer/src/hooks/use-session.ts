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
import { SessionEnvelopeIntake } from "../models/session-envelope-intake"
import {
  createSessionState,
  reduceSession,
  sessionErrorText,
  type SessionUiState,
} from "../models/session-model"
import type { SessionPermissionStatus } from "../models/session-permissions"

/** 聊天页和环境页共用的会话控制器。 */
export type SessionController = {
  state: SessionUiState
  status: SessionStatusView | null
  models: ClaudeModel[]
  modelsLoading: boolean
  modelsError: string | null
  /** Claude Code 没有列出模型的原因；这时 models 是主进程给的内置目录。 */
  modelsCliError: string | null
  start: (input: SessionStartInput) => Promise<boolean>
  /** 用选定的设置发送；消息未被接受时返回 false，界面保留草稿。 */
  send: (text: string, options?: SessionSendOptions) => Promise<boolean>
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
  clearError: () => void
}

const modelsTimeoutMs = 20_000
const notStarted = "SDK_ERROR: 会话未开始"

function now(): string {
  return new Date().toISOString()
}

/** 订阅会话事件。传入 null 表示桌面桥不可用，所有命令都会给出可读错误。 */
export function useSession(bridge?: SessionBridge | null): SessionController {
  const resolved = bridge === undefined ? window.pigclaude?.session : bridge
  const [state, dispatch] = useReducer(reduceSession, undefined, createSessionState)
  const [status, setStatus] = useState<SessionStatusView | null>(null)
  const [models, setModels] = useState<ClaudeModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsCliError, setModelsCliError] = useState<string | null>(null)
  const turnSeq = useRef(0)
  const activeTurnRef = useRef<string | null>(null)
  const targetRef = useRef<string | null>(null)
  const startingRef = useRef<Promise<string | null> | null>(null)
  const modelsLoaded = useRef(false)
  const modelsLoadingRef = useRef(false)
  const modelsRequest = useRef(0)

  const refreshStatus = useCallback(async () => {
    if (resolved === null || resolved === undefined) return
    const sessionId = targetRef.current
    try {
      setStatus(await (sessionId === null ? resolved.status() : resolved.status({ sessionId })))
    } catch {
      setStatus(null)
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
      apply: (envelope) => {
        const { sessionId, event } = envelope
        if (targetRef.current === null && sessionId !== null) targetRef.current = sessionId
        if (event.type === "turn-ended" || event.type === "ended") activeTurnRef.current = null
        dispatch({ type: "envelope", envelope })
      },
    })
    const unsubscribe = resolved.subscribe((envelope) => intake.receive(envelope))
    void refreshStatus()
    return () => {
      intake.close()
      unsubscribe()
    }
  }, [refreshStatus, resolved])

  const start = useCallback(
    async (input: SessionStartInput): Promise<boolean> => {
      if (resolved === null || resolved === undefined) {
        dispatch({ type: "failed", message: "桌面会话服务不可用", at: now() })
        return false
      }
      dispatch({ type: "starting" })
      activeTurnRef.current = null
      targetRef.current = null
      const pending = resolved.start(input)
      startingRef.current = pending.then(
        (result) => result.sessionId,
        () => null,
      )
      try {
        const result = await pending
        targetRef.current = result.sessionId
        dispatch({ type: "opened", sessionId: result.sessionId })
        void refreshStatus()
        return true
      } catch (error: unknown) {
        dispatch({ type: "failed", message: sessionErrorFrom(error), at: now() })
        return false
      }
    },
    [refreshStatus, resolved],
  )

  const send = useCallback(
    async (text: string, options?: SessionSendOptions): Promise<boolean> => {
      if (resolved === null || resolved === undefined) {
        dispatch({ type: "failed", message: "桌面会话服务不可用", at: now() })
        return false
      }
      // 当前 turn 未结束时拒绝第二次发送，避免为一个 turn 建两条用户消息。
      if (activeTurnRef.current !== null) return false
      const sessionId = targetRef.current
      if (sessionId === null) {
        dispatch({ type: "failed", message: notStarted, at: now() })
        return false
      }
      turnSeq.current += 1
      const turnId = `turn-${turnSeq.current}`
      activeTurnRef.current = turnId
      dispatch({ type: "user-message", text, turnId, at: now() })
      try {
        await resolved.send({ ...options, sessionId, text })
        return true
      } catch (error: unknown) {
        if (activeTurnRef.current === turnId) {
          activeTurnRef.current = null
          dispatch({ type: "failed", message: sessionErrorFrom(error), at: now() })
        }
        return false
      }
    },
    [resolved],
  )

  const cancel = useCallback(async (): Promise<void> => {
    dispatch({ type: "cancel-requested", at: now() })
    const sessionId = targetRef.current
    if (sessionId === null) return
    try {
      await resolved?.cancel({ sessionId })
    } catch (error: unknown) {
      dispatch({ type: "failed", message: sessionErrorFrom(error), at: now() })
    }
  }, [resolved])

  const stop = useCallback(async (): Promise<void> => {
    const sessionId = targetRef.current ?? (await startingRef.current)
    try {
      if (sessionId !== null) await resolved?.stop({ sessionId })
    } catch (error: unknown) {
      dispatch({ type: "failed", message: sessionErrorFrom(error), at: now() })
      return
    }
    activeTurnRef.current = null
    dispatch({ type: "stopped", at: now() })
    void refreshStatus()
  }, [refreshStatus, resolved])

  const respondPermission = useCallback(
    async (
      requestId: string,
      decision: "allow" | "deny",
      updatedPermissions?: unknown[],
    ): Promise<void> => {
      dispatch({ type: "permission-answered", requestId, decision, at: now() })
      const sessionId = targetRef.current
      if (sessionId === null) return
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
        dispatch({ type: "failed", message: sessionErrorFrom(error), at: now() })
      }
    },
    [resolved],
  )

  const answerQuestion = useCallback(
    async (requestId: string, answers: string[]): Promise<void> => {
      const sessionId = targetRef.current
      if (sessionId === null) return
      try {
        await resolved?.answerQuestion({ sessionId, requestId, answers })
      } catch (error: unknown) {
        dispatch({ type: "failed", message: sessionErrorFrom(error), at: now() })
      }
    },
    [resolved],
  )

  const setMode = useCallback(
    async (mode: SessionUiState["permissionMode"]): Promise<void> => {
      const sessionId = targetRef.current
      if (sessionId === null) return
      try {
        await resolved?.setMode({ sessionId, mode })
      } catch (error: unknown) {
        dispatch({ type: "failed", message: sessionErrorFrom(error), at: now() })
      }
    },
    [resolved],
  )

  const setModel = useCallback(
    async (model: string): Promise<void> => {
      dispatch({ type: "model-changed", model })
      const sessionId = targetRef.current
      if (sessionId === null) return
      try {
        await resolved?.setModel({ sessionId, model })
      } catch (error: unknown) {
        dispatch({ type: "failed", message: sessionErrorFrom(error), at: now() })
      }
    },
    [resolved],
  )

  const clearError = useCallback(() => dispatch({ type: "clear-error" }), [])

  return {
    state,
    status,
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
    clearError,
  }
}

/** 会话正在用的账号：先取换号事件记下的账号，再取主进程状态；都不知道时返回 null。 */
export function sessionAccountId(
  session: Pick<SessionController, "state" | "status">,
): string | null {
  return session.state.accountId ?? session.status?.accountId ?? null
}

/** 把未知错误转成文本；主进程前缀由 sessionErrorText 统一剥离。 */
export function sessionErrorFrom(error: unknown): string {
  return error instanceof Error ? error.message : "会话操作失败"
}

/** 权限卡片状态的展示文案，页面和测试共用。 */
export function permissionStatusText(status: SessionPermissionStatus): string {
  switch (status) {
    case "allowed":
      return "已允许一次"
    case "denied":
      return "已拒绝"
    case "timeout":
      return "权限询问超时，已拒绝"
    default:
      return "等待回答"
  }
}
