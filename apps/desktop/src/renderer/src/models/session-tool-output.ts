// 给工作台截图保存实时图文块，其他工具继续使用原有的文本输出。
import { browserScreenshotToolName } from "../../../browser-permission-contract"
import type { SessionHostEvent } from "../../../main/session/session-types"

/** 已识别的进程内截图工具才把有界图片交给现有浏览器结果组件。 */
export function sessionToolOutput(
  event: Extract<SessionHostEvent, { type: "tool-result" }>,
  name: string | undefined,
) {
  if (name !== browserScreenshotToolName || !event.image || event.isError) return event.content
  return [{ type: "text" as const, text: event.content }, event.image]
}
