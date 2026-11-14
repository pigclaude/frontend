// 定义桌面会话历史的操作输入和自动保留期，供主进程、preload 与页面共用。

/** Claude Code 在每个独立会话目录里允许保留的最大天数。 */
export const maxSessionRetentionDays = 36_500

/** null 表示只在用户明确删除时清理。 */
export type SessionRetention = { days: number | null }

/** 已保存的会话数和目录中的普通文件字节数。 */
export type SessionHistoryStats = { count: number; bytes: number }

/** 命令是否只列出已归档会话；默认列出未归档会话。 */
export type SessionListInput = { archived?: boolean }

/** 历史管理的桌面桥，不带任何文件系统路径。 */
export type SessionHistoryBridge = {
  rename: (input: { sessionId: string; title: string }) => Promise<void>
  archive: (input: { sessionId: string; archived: boolean }) => Promise<void>
  delete: (input: { sessionId: string }) => Promise<void>
  dataStats: () => Promise<SessionHistoryStats>
  clearHistory: () => Promise<void>
  retention: () => Promise<SessionRetention>
  setRetention: (input: SessionRetention) => Promise<SessionRetention>
}

/** 校验保留天数，允许明确关闭保留期。 */
export function isSessionRetentionDays(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= maxSessionRetentionDays)
  )
}
