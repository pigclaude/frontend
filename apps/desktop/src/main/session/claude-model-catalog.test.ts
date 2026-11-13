// 负责验证模型目录整理：实时目录优先、别名补全、默认标记、思考档位和快速模式。

import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk"
import { describe, expect, it } from "vitest"
import { CLAUDE_FALLBACK_MODELS, mergeClaudeModels } from "./claude-model-catalog"

const efforts = ["low", "medium", "high", "xhigh", "max"] as const

function live(overrides: Partial<ModelInfo> & Pick<ModelInfo, "value">): ModelInfo {
  return {
    displayName: overrides.value,
    description: `${overrides.value} 说明`,
    supportsEffort: true,
    supportedEffortLevels: [...efforts],
    ...overrides,
  }
}

describe("mergeClaudeModels", () => {
  it("marks the first live row as default and keeps SDK metadata", () => {
    const models = mergeClaudeModels([
      live({
        value: "default",
        resolvedModel: "claude-opus-5-5",
        displayName: "Default (recommended)",
        supportsFastMode: true,
      }),
      live({ value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5" }),
      live({ value: "claude-opus-5-5", displayName: "Opus 5.5" }),
    ])

    expect(models[0]).toMatchObject({
      id: "default",
      isDefault: true,
      efforts: [...efforts],
      fast: true,
    })
    expect(models.filter((model) => model.isDefault)).toHaveLength(1)
    expect(models.find((model) => model.id === "opus")?.displayName).toBe("Opus 5.5")
    expect(models.filter((model) => model.id === "claude-opus-5-5")).toHaveLength(1)
    // 实时目录没有的规范模型仍然补上，避免选择器只剩几条。
    expect(models.some((model) => model.id === "claude-haiku-4-5-20251001")).toBe(true)
  })

  it("normalizes the alias-only fallback and appends the canonical models", () => {
    const models = mergeClaudeModels([
      live({
        value: "default",
        resolvedModel: "claude-sonnet-5-5",
        displayName: "Default (recommended)",
        description: "Sonnet 5.5 · Efficient for routine tasks",
      }),
      live({
        value: "sonnet",
        resolvedModel: "claude-sonnet-5-5",
        displayName: "Sonnet",
        description: "Sonnet 5.5 · Efficient for routine tasks",
      }),
      live({ value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable" }),
      live({ value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus" }),
      live({ value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku" }),
    ])

    expect(models.map((model) => model.id)).toEqual([
      "default",
      "sonnet",
      "fable",
      "opus",
      "haiku",
      "claude-fable-5-2",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ])
    expect(models.find((model) => model.id === "sonnet")?.displayName).toBe("Sonnet 5.5")
    expect(models.find((model) => model.id === "fable")?.displayName).toBe("Fable 5.1")
    expect(models.find((model) => model.id === "opus")?.displayName).toBe("Opus 5.5")
    expect(models.find((model) => model.id === "haiku")?.displayName).toBe("Haiku 5.5")
    expect(models[0]?.displayName).toBe("Default (recommended)")
  })

  it("returns the fallback catalog when the SDK gives nothing", () => {
    const models = mergeClaudeModels([])

    expect(models).toEqual(CLAUDE_FALLBACK_MODELS)
    expect(models[0]?.isDefault).toBe(true)
  })

  it("keeps models without adjustable effort empty", () => {
    const models = mergeClaudeModels([
      live({ value: "claude-haiku-4-5-20251001", supportsEffort: false }),
    ])

    expect(models[0]?.efforts).toEqual([])
  })
})
