// 负责 SDK canUseTool 的分流：能读出问题的 AskUserQuestion 交给提问代理，ExitPlanMode 和其他工具
// 交给权限代理。两个代理共用一个会话的待答队列。

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { parseQuestions } from "./ask-user-question"
import type { PermissionBroker } from "./permission-broker"
import type { QuestionBroker } from "./question-broker"
import { isBuiltinThreadRead } from "./thread-read"

/** 内置 thread_read 在自身作用域内执行；其余工具按现有规则分发权限或提问。 */
export function routeCanUseTool(
  permissions: PermissionBroker,
  questions: QuestionBroker,
  hasThreadRead = false,
  denyUnattended?: () => void,
): CanUseTool {
  return (toolName, input, options) => {
    if (
      !options.signal.aborted &&
      hasThreadRead &&
      isBuiltinThreadRead(toolName, options.mcpServer)
    ) {
      return Promise.resolve({ behavior: "allow", updatedInput: input })
    }
    if (denyUnattended !== undefined) {
      if (!options.signal.aborted) denyUnattended()
      return Promise.resolve({
        behavior: "deny",
        message: "Scheduled runs cannot request approvals. Continue without this operation.",
        interrupt: false,
      })
    }
    const asked = toolName === "AskUserQuestion" ? parseQuestions(input) : null
    if (asked !== null) return questions.ask(asked, input, options.signal)
    return permissions.request(toolName, input, options)
  }
}
