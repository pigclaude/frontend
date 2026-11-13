// 负责把 SDK 的模型目录整理成界面用的列表：保留实时目录，并在 CLI 只返回内置别名时补齐规范模型。
// 规范目录对齐 Claude Code 2.1.310 的模型；升级 CLI 或新增模型时同步这里。

import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk"
import type { ClaudeModel } from "./session-events"

/** SDK 只返回内置别名时的兜底模型；顺序是界面里的默认顺序。 */
export const CLAUDE_FALLBACK_MODELS: readonly ClaudeModel[] = [
  {
    id: "default",
    displayName: "Default (recommended)",
    description: "Claude Code 默认模型",
    isDefault: true,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  },
  {
    id: "claude-opus-5-5",
    displayName: "Opus 5.5",
    description: "For complex work and everyday tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  },
  {
    id: "claude-sonnet-5-5",
    displayName: "Sonnet 5.5",
    description: "Most efficient for simpler tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-fable-5-2",
    displayName: "Fable 5.2",
    description: "For your toughest challenges",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-haiku-5-5",
    displayName: "Haiku 5.5",
    description: "Fastest for quick answers",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-fable-5-1",
    displayName: "Fable 5.1",
    description: "Most capable for your hardest and longest-running tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-opus-5",
    displayName: "Opus 5",
    description: "Best for everyday, complex tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  },
  {
    id: "claude-sonnet-5",
    displayName: "Sonnet 5",
    description: "Efficient for routine tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-fable-5",
    displayName: "Fable 5",
    description: "Most capable for your hardest and longest-running tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-opus-4-8",
    displayName: "Opus 4.8",
    description: "Best for everyday, complex tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    fast: true,
  },
  {
    id: "claude-opus-4-7",
    displayName: "Opus 4.7",
    description: "Best for everyday, complex tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "claude-opus-4-6",
    displayName: "Opus 4.6",
    description: "Best for everyday, complex tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "max"],
  },
  {
    id: "claude-sonnet-4-6",
    displayName: "Sonnet 4.6",
    description: "Efficient for routine tasks",
    isDefault: false,
    efforts: ["low", "medium", "high", "max"],
  },
  {
    id: "claude-haiku-4-5-20251001",
    displayName: "Haiku 4.5",
    description: "Fastest for quick answers",
    isDefault: false,
    efforts: [],
  },
]

/** SDK 内置别名；这些行的名字是短名，用规范目录补全。 */
const aliasIds = new Set(["default", "opus", "sonnet", "fable", "haiku"])

/** 把 SDK 的模型信息转成界面模型；第一行是 CLI 的默认选择。 */
function fromSdk(model: ModelInfo, index: number): ClaudeModel {
  const found = CLAUDE_FALLBACK_MODELS.find(
    (item) => item.id === model.resolvedModel || item.id === model.value,
  )
  const catalog = aliasIds.has(model.value) ? found : undefined
  const efforts =
    catalog !== undefined
      ? (catalog.efforts ?? [])
      : model.supportsEffort === false
        ? []
        : (model.supportedEffortLevels ?? [])
  const fast = catalog !== undefined ? catalog.fast === true : model.supportsFastMode === true
  return {
    id: model.value,
    ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
    // default 的显示名保持 CLI 的 "Default (recommended)"，其余别名用规范目录的全名。
    displayName:
      model.value === "default" || catalog === undefined ? model.displayName : catalog.displayName,
    description:
      model.value === "default" || catalog === undefined ? model.description : catalog.description,
    isDefault: index === 0,
    efforts,
    ...(fast ? { fast: true } : {}),
  }
}

/**
 * 整理 SDK 返回的模型目录：先保留实时结果，再把规范目录里缺少的模型补上。
 * 保证默认行只有第一行；CLI 只返回别名时，规范模型仍会出现在选择器里。
 */
export function mergeClaudeModels(models: readonly ModelInfo[]): ClaudeModel[] {
  const live = models.map(fromSdk)
  const seen = new Set(live.map((model) => model.id))
  const seenResolved = new Set(
    live.flatMap((model) => (model.resolvedModel ? [model.resolvedModel] : [])),
  )
  const missing = CLAUDE_FALLBACK_MODELS.filter(
    (model) => !seen.has(model.id) && !(model.id !== "default" && seenResolved.has(model.id)),
  )
  return [...live, ...missing]
}
