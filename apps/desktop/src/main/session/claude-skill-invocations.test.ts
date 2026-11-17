// 验证 Claude 只展开用户正文里的 skill，已有引用和普通的美元符号不会变成命令。

import { expect, it, vi } from "vitest"
import { claudeSkillContent, readClaudeSkillInvocation } from "./claude-skill-invocations"

it("保留引用材料并使用最后一个已知 skill 的原生调用", async () => {
  const reference = "Earlier conversation mentioned $private-skill .\n\n"
  const first = readClaudeSkillInvocation(
    "manual-check",
    "/repo/.claude/skills/manual-check/SKILL.md",
    "---\ndisable-model-invocation: true\n---\n",
  )
  const last = readClaudeSkillInvocation("review", "/repo/.claude/skills/review/SKILL.md", "")
  const fromHistory = readClaudeSkillInvocation("private-skill", "/repo/private/SKILL.md", "")
  if (!first || !last || !fromHistory) throw new Error("测试 skill 未创建")

  const content = await claudeSkillContent(
    reference + "Use ￥manual-check then ¥review for $20 .",
    async () => [first, last, fromHistory],
    reference.length,
  )
  expect(content).toEqual([
    {
      type: "text",
      text:
        reference +
        'Use /manual-check [Apply the user-selected skill at "/repo/.claude/skills/manual-check/SKILL.md".] then /review for $20 .',
    },
    { type: "text", text: "/review for $20 ." },
  ])
})

it("显式斜杠指令和未匹配的文字原样发送", async () => {
  const load = vi.fn(async () => [])
  await expect(claudeSkillContent("/run $review", load)).resolves.toBe("/run $review")
  await expect(claudeSkillContent("Costs $30k", load)).resolves.toBe("Costs $30k")
  expect(load).not.toHaveBeenCalled()
  await expect(claudeSkillContent("Keep $HOME unchanged", load)).resolves.toBe(
    "Keep $HOME unchanged",
  )
})
