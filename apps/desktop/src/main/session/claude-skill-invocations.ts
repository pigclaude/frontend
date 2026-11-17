// 读取 Claude skill 的本地元数据，并将输入框的 $ 提及交给 CLI 原生展开。

import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { AgentCommand } from "@pigclaude/ui-contracts"
import { isClaudeSkillName } from "./claude-commands"
import { readClaudeMarkdown } from "./claude-markdown"

/** 能由用户点选的 skill，只保留展示元数据与原始文件路径。 */
export type ClaudeSkillInvocation = {
  name: string
  path: string
  description?: string
  userInvocationOnly: boolean
}

const skillMention =
  /(^|\s)[$¥￥](?!\d[\d_]*(?:[kKmMbBtT]|[eE]\d+)?(?:\s|$))([a-zA-Z0-9][\w.:-]*)(?=\s|$)/gu

/** 以目录名为原生调用名，尊重 skill 文件头中的手动调用开关。 */
export function readClaudeSkillInvocation(
  name: string,
  path: string,
  text: string,
): ClaudeSkillInvocation | null {
  if (!isClaudeSkillName(name)) return null
  try {
    const { frontmatter } = readClaudeMarkdown(text)
    if (frontmatter["user-invocable"] === false) return null
    const description =
      typeof frontmatter["description"] === "string"
        ? frontmatter["description"].trim().slice(0, 300)
        : ""
    return {
      name,
      path,
      ...(description ? { description } : {}),
      userInvocationOnly: frontmatter["disable-model-invocation"] === true,
    }
  } catch {
    return null
  }
}

/** 为输入框生成带来源标记的 Skill 选项，原生斜杠命令仍由命令目录提供。 */
export function claudeSkillChoice(
  skill: ClaudeSkillInvocation,
  scope: "project" | "user",
): AgentCommand {
  return {
    name: skill.name,
    text: "$" + skill.name,
    kind: "skill",
    path: skill.path,
    scope,
    ...(skill.description ? { description: skill.description } : {}),
  }
}

/** Claude 展开最后一条已知 skill；引用前缀和未识别的提及按原文交给模型。 */
export async function claudeSkillContent(
  text: string,
  load: () => Promise<readonly ClaudeSkillInvocation[]>,
  userTextOffset = 0,
): Promise<SDKUserMessage["message"]["content"]> {
  const userText = text.slice(userTextOffset)
  if (/^\/[^/\s]+(?:\s|$)/.test(userText.trimStart())) return text
  const matches = [...userText.matchAll(skillMention)]
  if (matches.length === 0) return text
  const skills = new Map((await load()).map((skill) => [skill.name, skill]))
  const mentions = matches.flatMap((match) => {
    const skill = skills.get(match[2] ?? "")
    if (!skill) return []
    const offset = userTextOffset + (match.index ?? 0)
    return [{ skill, start: offset + (match[1]?.length ?? 0), end: offset + match[0].length }]
  })
  const last = mentions.at(-1)
  if (!last) return text

  const leading: string[] = []
  const annotated = new Set([last.skill.name])
  let cursor = 0
  for (const { skill, start, end } of mentions) {
    leading.push(text.slice(cursor, start), "/" + skill.name)
    if (skill.userInvocationOnly && !annotated.has(skill.name)) {
      leading.push(" [Apply the user-selected skill at " + JSON.stringify(skill.path) + ".]")
      annotated.add(skill.name)
    }
    cursor = end
  }
  leading.push(text.slice(cursor))
  const command = "/" + last.skill.name + text.slice(last.end)
  const content: Exclude<SDKUserMessage["message"]["content"], string> = []
  if (text.slice(0, last.start).trim()) {
    content.push({ type: "text", text: leading.join("").trimEnd() })
  }
  content.push({ type: "text", text: command.trimEnd() })
  return content
}
