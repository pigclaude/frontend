// 负责给 Pigcode 时间线注册内置工具行：终端、文件读写、搜索、网页抓取、MCP 和浏览器
// 都用 ui-chat 自带的专用卡片，而不是通用回退行。

import type { ReactNode } from "react"
import {
  BUILTIN_TOOL_ROWS,
  ToolRenderersContext,
  toolFamily,
  type ToolRendererEntry,
} from "@pigclaude/ui-chat"

/** 按工具族匹配的内置渲染器；族之间互斥，顺序不影响结果。 */
const builtinRenderers: readonly ToolRendererEntry[] = BUILTIN_TOOL_ROWS.map(
  ([family, render]) => ({
    matches: (name: string) => toolFamily(name) === family,
    render,
  }),
)

/** 给 ChatView 和 NewThreadView 提供工具渲染器扩展点。 */
export function ToolRenderers({ children }: { children: ReactNode }): ReactNode {
  return (
    <ToolRenderersContext.Provider value={builtinRenderers}>
      {children}
    </ToolRenderersContext.Provider>
  )
}
