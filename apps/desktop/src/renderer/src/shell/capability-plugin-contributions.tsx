// 把主进程给出的声明注册进桌面命令与工具时间线；组件和执行回调全部由 PigClaude 提供。
import type { ExtensionRegistry } from "@pigclaude/client-runtime"
import { McpRow, type ToolCall } from "@pigclaude/ui-chat"
import type { CapabilityPluginDeclarations } from "../../../capability-plugin-contract"

const maximumTemplateOutput = 16_384

/** 登记一个已启用插件的命令和精确工具渲染器；注销后旧菜单回调也失效。 */
export function registerCapabilityPluginContributions(
  registry: ExtensionRegistry,
  source: CapabilityPluginDeclarations,
  run: (commandId: string) => Promise<void>,
): () => void {
  const owner = { kind: "plugin" as const, id: source.pluginId }
  let active = true
  const commands = source.commands.map(({ id, title, description, slash }) =>
    registry.register("command", {
      id: ["capability-plugin", source.pluginId, id].join(":"),
      owner,
      order: 0,
      title: { text: title },
      ...(description === undefined ? {} : { keywords: [description] }),
      ...(slash === undefined ? {} : { slash: slash.slice(1) }),
      available: () => active,
      run: async () => {
        if (active) await run(id)
      },
    }),
  )
  const templates = source.toolResults.map(({ toolName, template }) =>
    registry.register("toolRenderer", {
      id: toolName,
      owner,
      order: 0,
      matches: (name) => name === toolName,
      render: ({ tool, showIcon }) => (
        <McpRow tool={withResultTemplate(tool, template)} showIcon={showIcon} />
      ),
    }),
  )
  return () => {
    active = false
    for (const dispose of [...commands, ...templates]) dispose()
  }
}

function withResultTemplate(tool: ToolCall, template: string): ToolCall {
  if (tool.status !== "completed" || tool.output === undefined) return tool
  const result = toolResultText(tool)
  const fields = json(result)
  const text = template.replace(
    /\{\{\s*([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)\s*\}\}/g,
    (_, path: string) =>
      path === "result" ? result.slice(0, maximumTemplateOutput) : fieldText(fields, path),
  )
  // 使用内置 MCP 行保留展开、状态和参数；模板只会形成一个文本块。
  return {
    ...tool,
    output: JSON.stringify([{ type: "text", text: text.slice(0, maximumTemplateOutput) }]),
  }
}

function toolResultText(tool: ToolCall): string {
  const output = tool.outputValue ?? json(tool.output ?? "")
  if (!Array.isArray(output) || output.length !== 1) return tool.output ?? ""
  const block: unknown = output[0]
  return typeof block === "object" &&
    block !== null &&
    "type" in block &&
    block.type === "text" &&
    "text" in block &&
    typeof block.text === "string"
    ? block.text
    : (tool.output ?? "")
}

function fieldText(value: unknown, path: string): string {
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) return ""
    value = (value as Record<string, unknown>)[key]
  }
  if (typeof value === "string") return value.slice(0, maximumTemplateOutput)
  return typeof value === "boolean" || typeof value === "number" ? String(value) : ""
}

function json(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
