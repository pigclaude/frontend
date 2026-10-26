// 负责把 preload 会话桥接到界面控制器：订阅事件、维护会话模型、加载模型探针并转发命令。
// 页面只消费这个控制器，不直接调用 window.pigclaude。

import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type {
  ClaudeModel,
  SessionBridge,
  SessionStartInput,
  SessionStatusView,
} from "../../../main/session/session-types"
import {
  createSessionState,
  reduceSession,
  sessionErrorText,
  type SessionPermissionStatus,
  type SessionUiState,
} from "../models/session-model"

/** 聊天页和环境页共用的会话控制器。 */
export type SessionController = {
  state: SessionUiState
  status: SessionStatusView | null
  models: ClaudeModel[]
  modelsLoading: boolean
  modelsError: string | null
  start: (input: SessionStartInput) => Promise<boolean>
  send: (text: string) => Promise<void>
  cancel: () => Promise<void>
  stop: () => Promise<void>
  respondPermission: (requestId: string, decision: "allow" | "deny") => Promise<void>
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

/** 订阅会话事件。传入 null 表示桌面桥不可用，所有命令都会给出可读错误。 */
export function useSession(bridge?: SessionBridge | null): SessionController {
  const resolved = bridge === undefined ? window.pigclaude?.session : bridge
  const [state, dispatch] = useReducer(reduceSession, undefined, createSessionState)
  const [status, setStatus] = useState<SessionStatusView | null>(null)
  const [models, setModels] = useState<ClaudeModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const turnSeq = useRef(0)
  const modelsLoaded = useRef(false)
  const modelsLoadingRef = useRef(false)
  const modelsRequest = useRef(0)

  const refreshStatus = useCallback(async () => {
    if (resolved === null || resolved === undefined) return
    try {
      setStatus(await resolved.status())
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
      const timer = setTimeout(() => {
        if (request !== modelsRequest.current) return
        modelsRequest.current += 1
        modelsLoadingRef.current = false
        setModelsLoading(false)
        setModelsError("模型查询超时，请重试")
      }, modelsTimeoutMs)
      try {
        const list = await resolved.models()
        if (request !== modelsRequest.current) return
        modelsLoaded.current = true
        setModels(list)
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
    const unsubscribe = resolved.subscribe((event) => dispatch({ type: "event", event }))
    void refreshStatus()
    return unsubscribe
  }, [refreshStatus, resolved])

  const start = useCallback(
    async (input: SessionStartInput): Promise<boolean> => {
      if (resolved === null || resolved === undefined) {
        dispatch({ type: "failed", message: "桌面会话服务不可用" })
        return false
      }
      dispatch({ type: "starting" })
      try {
        const result = await resolved.start(input)
        dispatch({ type: "opened", sessionId: result.sessionId })
        void refreshStatus()
        return true
      } catch (error: unknown) {
        dispatch({ type: "failed", message: sessionErrorFrom(error) })
        return false
      }
    },
    [refreshStatus, resolved],
  )

  const send = useCallback(
    async (text: string): Promise<void> => {
      if (resolved === null || resolved === undefined) {
        dispatch({ type: "failed", message: "桌面会话服务不可用" })
        return
      }
      turnSeq.current += 1
      dispatch({ type: "user-message", text, turnId: `turn-${turnSeq.current}` })
      try {
        await resolved.send({ text })
      } catch (error: unknown) {
        dispatch({ type: "failed", message: sessionErrorFrom(error) })
      }
    },
    [resolved],
  )

  const cancel = useCallback(async (): Promise<void> => {
    dispatch({ type: "cancel-requested" })
    try {
      await resolved?.cancel()
    } catch (error: unknown) {
      dispatch({ type: "failed", message: sessionErrorFrom(error) })
    }
  }, [resolved])

  const stop = useCallback(async (): Promise<void> => {
    try {
      await resolved?.stop()
    } catch (error: unknown) {
      dispatch({ type: "failed", message: sessionErrorFrom(error) })
      return
    }
    dispatch({ type: "stopped" })
    void refreshStatus()
  }, [refreshStatus, resolved])

  const respondPermission = useCallback(
    async (requestId: string, decision: "allow" | "deny"): Promise<void> => {
      dispatch({ type: "permission-answered", requestId, decision })
      try {
        await resolved?.respondPermission({ requestId, decision })
      } catch (error: unknown) {
        dispatch({ type: "failed", message: sessionErrorFrom(error) })
      }
    },
    [resolved],
  )

  const setMode = useCallback(
    async (mode: SessionUiState["permissionMode"]): Promise<void> => {
      dispatch({ type: "mode-changed", mode })
      try {
        await resolved?.setMode(mode)
      } catch (error: unknown) {
        dispatch({ type: "failed", message: sessionErrorFrom(error) })
      }
    },
    [resolved],
  )

  const setModel = useCallback(
    async (model: string): Promise<void> => {
      dispatch({ type: "model-changed", model })
      try {
        await resolved?.setModel(model)
      } catch (error: unknown) {
        dispatch({ type: "failed", message: sessionErrorFrom(error) })
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
    start,
    send,
    cancel,
    stop,
    respondPermission,
    setMode,
    setModel,
    refreshModels,
    cancelModels,
    refreshStatus,
    clearError,
  }
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
