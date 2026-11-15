// 负责 SDK canUseTool 的分流：能读出问题的 AskUserQuestion 交给提问代理，ExitPlanMode 和其他工具
// 交给权限代理。两个代理共用一个会话的待答队列。

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import type { CapabilityPluginToolApprovals } from "../plugins/capability-plugin-tools"
import { parseQuestions } from "./ask-user-question"
import type { PermissionBroker } from "./permission-broker"
import type { QuestionBroker } from "./question-broker"
import { isBuiltinThreadRead } from "./thread-read"

/** 内置 thread_read 在自身作用域内执行；插件逐次审批留给 MCP 调用，其余由会话回答。 */
export function routeCanUseTool(
  permissions: PermissionBroker,
  questions: QuestionBroker,
  hasThreadRead = false,
  denyUnattended?: () => void,
  pluginApprovals?: CapabilityPluginToolApprovals,
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
    const plugin = pluginApprovals?.lookup(toolName, options.mcpServer)
    if (plugin !== undefined) {
      if (options.signal.aborted || !pluginApprovals?.available())
        return Promise.resolve({
          behavior: "deny",
          message: "This capability plugin is unavailable for this session.",
        })
      if (plugin.approval === "always_ask") {
        // MCP 回调重新核验资格并生成一次性卡，SDK 的检查不发第二张卡。
        return Promise.resolve({ behavior: "allow", updatedInput: input })
      }
      return permissions.request(toolName, input, { ...options, plugin: plugin.source })
    }
    const asked = toolName === "AskUserQuestion" ? parseQuestions(input) : null
    if (asked !== null) return questions.ask(asked, input, options.signal)
    return permissions.request(toolName, input, options)
  }
}
