// 负责 SDK canUseTool 的分流：能读出问题的 AskUserQuestion 交给提问代理，ExitPlanMode 和其他工具
// 交给权限代理。两个代理共用一个会话的待答队列。

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { parseQuestions } from "./ask-user-question"
import type { PermissionBroker } from "./permission-broker"
import type { QuestionBroker } from "./question-broker"

/** 按工具名分流的 canUseTool；读不出问题的 AskUserQuestion 仍按普通权限询问处理。 */
export function routeCanUseTool(
  permissions: PermissionBroker,
  questions: QuestionBroker,
): CanUseTool {
  return (toolName, input, options) => {
    const asked = toolName === "AskUserQuestion" ? parseQuestions(input) : null
    if (asked !== null) return questions.ask(asked, input, options.signal)
    return permissions.request(toolName, input, options)
  }
}
