// 负责 SDK canUseTool 的分流：能读出问题的 AskUserQuestion 交给提问代理，ExitPlanMode 和其他工具
// 交给权限代理。两个代理共用一个会话的待答队列。

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import type { CapabilityPluginToolApprovals } from "../plugins/capability-plugin-tools"
import { parseQuestions } from "./ask-user-question"
import { builtinWorkbenchBrowserTool, type BrowserApprovalPort } from "./browser-tool-approval"
import type { PermissionBroker } from "./permission-broker"
import type { QuestionBroker } from "./question-broker"
import { isBuiltinThreadRead } from "./thread-read"

/** 内置 thread_read 在自身作用域内执行；工作台和插件的逐次审批由各自 MCP 处理函数发起。 */
export function routeCanUseTool(
  permissions: PermissionBroker,
  questions: QuestionBroker,
  hasThreadRead = false,
  denyUnattended?: () => void,
  pluginApprovals?: CapabilityPluginToolApprovals,
  browser?: BrowserApprovalPort,
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
    const browserTool = browser && builtinWorkbenchBrowserTool(toolName, options.mcpServer)
    if (browser && browserTool) {
      const denied = options.signal.aborted
        ? "The browser action was cancelled."
        : browser.denial(browserTool)
      // 真正的审批由工作台回调发起，SDK 的检查不再生成第二张卡。
      if (denied !== null) return Promise.resolve({ behavior: "deny", message: denied })
      browser.rememberCaller(browserTool, options)
      return Promise.resolve({ behavior: "allow", updatedInput: input })
    }
    const plugin = pluginApprovals?.lookup(toolName, options.mcpServer)
    if (plugin !== undefined) {
      if (options.signal.aborted || !pluginApprovals?.available())
        return Promise.resolve({
          behavior: "deny",
          message: "This capability plugin is unavailable for this session.",
        })
      if (plugin.approval === "always_ask") {
        pluginApprovals.rememberCaller(toolName, options)
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
