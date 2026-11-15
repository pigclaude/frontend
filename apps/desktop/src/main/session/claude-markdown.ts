// 解析 Claude Markdown 的文件头并披露执行声明，文件正文仍由调用方保存。

import { load } from "js-yaml"

/** 从 Markdown 取 YAML 文件头和值，兼容 BOM 及 CRLF。 */
export function readClaudeMarkdown(text: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  const value: unknown = match?.[1] === undefined ? null : load(match[1])
  const frontmatter =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return { frontmatter, body: text.slice(match?.[0].length ?? 0) }
}

/** 仅记录是否声明了可执行项，不返回命令正文、hook 或工具参数。 */
export function skillExecutionOf({ frontmatter, body }: ReturnType<typeof readClaudeMarkdown>) {
  return {
    inline: /!\u0060[^\u0060]+\u0060|(?:^|\n)[ \t]*\u0060{3,}![ \t]*(?:\r?\n|$)/.test(body),
    hooks: "hooks" in frontmatter,
    allowedTools: "allowed-tools" in frontmatter,
  }
}
