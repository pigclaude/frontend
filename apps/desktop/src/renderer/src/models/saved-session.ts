// 读取已保存会话摘要里重启后仍可使用的标题、项目和续接状态。

import type { SessionSummary } from "../../../main/session/session-summary"

/** 会话摘要可携带索引元数据；没有落盘的会话仍使用原摘要。 */
export type SavedSessionSummary = SessionSummary

/** 历史会话可以从停放、中断或失败状态续接；运行时命令仍走原有发送入口。 */
export function needsSessionResume(summary: SavedSessionSummary | undefined): boolean {
  return (
    summary?.restorable === true &&
    (summary.status === "parked" || summary.status === "interrupted" || summary.status === "failed")
  )
}
