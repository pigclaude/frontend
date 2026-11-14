// 负责向页面暴露应用更新：读取和订阅状态、执行动作、手动检查、改自动检查开关和打开发布页。
// 发布页地址只在主进程，页面只能请求打开当前的发布页。
import { ipcRenderer } from "electron"
import type { DesktopUpdateState } from "@pigclaude/ui-contracts"
import type { UpdateResult } from "../main/updates/update-service"

/** 页面使用的更新能力；主进程还没准备好时读取得到 null。 */
export type UpdatesBridge = {
  state: () => Promise<DesktopUpdateState | null>
  perform: () => Promise<DesktopUpdateState | null>
  check: () => Promise<UpdateResult>
  setAutoCheck: (value: boolean) => Promise<DesktopUpdateState | null>
  openReleaseNotes: () => Promise<void>
  /** 订阅状态变化；返回取消订阅函数。 */
  subscribe: (listener: (state: DesktopUpdateState) => void) => () => void
}

/** 创建更新桥；主进程返回的值都先收窄成约定的类型。 */
export function updatesBridge(): UpdatesBridge {
  const invokeForState = async (channel: string, ...args: unknown[]) => {
    const value: unknown = await ipcRenderer.invoke(channel, ...args)
    return isUpdateState(value) ? value : null
  }
  return {
    state: () => invokeForState("pigclaude:update-state"),
    perform: () => invokeForState("pigclaude:update-action"),
    check: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:update-check")
      return isCheckResult(value) ? value : { status: "error" }
    },
    setAutoCheck: (value) => invokeForState("pigclaude:update-auto-check", value),
    openReleaseNotes: () => ipcRenderer.invoke("pigclaude:update-release-notes"),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        if (isUpdateState(value)) listener(value)
      }
      ipcRenderer.on("pigclaude:update-state", handler)
      return () => ipcRenderer.removeListener("pigclaude:update-state", handler)
    },
  }
}

const PHASES = ["idle", "checking", "available", "downloading", "ready", "failed"]

function isUpdateState(value: unknown): value is DesktopUpdateState {
  if (typeof value !== "object" || value === null) return false
  const state = value as Record<string, unknown>
  return (
    typeof state.autoCheck === "boolean" &&
    PHASES.includes(String(state.phase)) &&
    typeof state.currentVersion === "string"
  )
}

function isCheckResult(value: unknown): value is UpdateResult {
  if (typeof value !== "object" || value === null) return false
  const status = (value as Record<string, unknown>).status
  return status === "up-to-date" || status === "update-available" || status === "error"
}
