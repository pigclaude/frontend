// 将会话历史命令交给受信主进程，校验存储统计和保留期的回复。

import { ipcRenderer } from "electron"
import { isSessionRetentionDays, type SessionHistoryBridge } from "../session-history-contract"

/** 为桌面窗口提供会话历史读写和本机保留规则。 */
export function sessionHistoryBridge(): SessionHistoryBridge {
  return {
    rename: (input) => ipcRenderer.invoke("pigclaude:session-rename", input),
    archive: (input) => ipcRenderer.invoke("pigclaude:session-archive", input),
    delete: (input) => ipcRenderer.invoke("pigclaude:session-delete", input),
    async dataStats() {
      const value: unknown = await ipcRenderer.invoke("pigclaude:session-data-stats")
      if (!isRecord(value) || !isCount(value.count) || !isCount(value.bytes)) throw invalid()
      return { count: value.count, bytes: value.bytes }
    },
    clearHistory: () => ipcRenderer.invoke("pigclaude:session-clear-history"),
    retention: () => readRetention("pigclaude:session-retention"),
    setRetention: (value) => readRetention("pigclaude:session-set-retention", value),
  }
}

async function readRetention(channel: string, input?: unknown) {
  const value: unknown = await ipcRenderer.invoke(channel, input)
  if (!isRecord(value) || !isSessionRetentionDays(value.days)) throw invalid()
  return { days: value.days }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function invalid(): Error {
  return new Error("INVALID_SESSION_RESPONSE")
}
