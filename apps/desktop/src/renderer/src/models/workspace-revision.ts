// 负责决定工作台什么时候重读项目：Claude 的工具调用结束或一轮结束后，文件树、Git 状态、Diff 和打开的文件都重读。
import type { SessionTurn } from "./session-model"

/** 可能改动过项目的事件数：结束的工具调用加上结束的轮次。只增不减，可以直接作为工作台的版本号。 */
export function workspaceRevision(turns: readonly SessionTurn[]): number {
  let revision = 0
  for (const turn of turns) {
    revision += turn.tools.filter((tool) => tool.status !== "running").length
    if (turn.result !== null) revision += 1
  }
  return revision
}
