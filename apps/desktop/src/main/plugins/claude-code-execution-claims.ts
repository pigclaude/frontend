// 为合成后的 Claude Code 提示组件记录执行声明指纹，避免把声明正文写入安装记录。

import { createHash } from "node:crypto"
import { dump } from "js-yaml"
import type { readClaudeMarkdown } from "../session/claude-markdown"

/** 按组件全名和声明类别返回实际声明的 SHA-256；忽略无执行内容的类别。 */
export function claudeCodeExecutionClaims(
  name: string,
  { frontmatter, body }: ReturnType<typeof readClaudeMarkdown>,
  header: string,
  manifestTools: readonly string[] | undefined,
): Readonly<Record<string, readonly string[]>> {
  const inline = [...body.matchAll(/!\u0060([^\u0060]+)\u0060/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )
  if (/(?:^|\n)[ \t]*\u0060{3,}![ \t]*(?:\r?\n|$)/.test(body)) inline.push("fenced\0" + body)
  const shell = frontmatter.shell === undefined ? "" : declarationText(frontmatter.shell, header)
  const hooks = frontmatter.hooks
  const hookClaims =
    hooks == null || (typeof hooks === "object" && Object.keys(hooks).length === 0)
      ? []
      : [declarationText(hooks, header)]
  const headerTools = permittedTools(frontmatter["allowed-tools"], header)
  const tools =
    manifestTools === undefined
      ? headerTools
      : [
          // 清单字段可能覆盖文件头；移除这个字段后，留存的声明也应重新比较。
          ...headerTools.map((tool) => "header-with-manifest\0" + tool),
          ...permittedTools(manifestTools, header).map((tool) => "manifest\0" + tool),
        ]
  const declarations = {
    "skill-inline": inline.map((command) => shell + "\0" + command),
    "skill-hooks": hookClaims,
    "skill-allowed-tools": tools,
  }
  return Object.fromEntries(
    Object.entries(declarations).flatMap(([category, values]) =>
      values.length === 0 ? [] : [[category + ":" + name, [...new Set(values.map(sha256))].sort()]],
    ),
  )
}

function permittedTools(value: unknown, header: string): string[] {
  if (typeof value === "string") {
    const text = value.trim()
    return /[()]/.test(text) ? [text] : text.split(/[\s,]+/).filter(Boolean)
  }
  if (Array.isArray(value))
    return value
      .map((tool: unknown) =>
        typeof tool === "string" ? tool.trim() : "declaration\0" + declarationText(tool, header),
      )
      .filter(Boolean)
  return value == null ? [] : ["declaration\0" + declarationText(value, header)]
}

function declarationText(value: unknown, header: string): string {
  try {
    return dump(value, { sortKeys: true, lineWidth: -1 })
  } catch {
    return header
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
