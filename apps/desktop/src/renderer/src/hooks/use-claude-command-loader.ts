// 将编辑器的 Claude Code 命令加载绑定到当前工作目录和会话。

import { useMemo } from "react"
import type { AgentCommand } from "@pigclaude/ui-contracts"

/** 编辑器查找命令时读主进程最新快照；草稿只枚举这个工作目录中的配置。 */
export function useClaudeCommandLoader(
  workspace: string | null,
  sessionId: string | null,
): ((instance: string) => Promise<readonly AgentCommand[]>) | undefined {
  const load = window.pigclaude?.session?.commands
  return useMemo(() => {
    if (load === undefined || workspace === null) return undefined
    return () => load({ workspace, ...(sessionId === null ? {} : { sessionId }) })
  }, [load, workspace, sessionId])
}
