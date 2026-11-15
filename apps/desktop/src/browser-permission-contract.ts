// 描述主进程为浏览器审批卡提供的工作台操作。

/** 浏览器可请求的主帧导航意向，由主进程解析成实际本机目标。 */
export type BrowserNavigationTarget = { url: string } | { action: "back" | "forward" | "reload" }

/** 工具层已校验的输入意向，只在对应元素获准后使用文本。 */
export type BrowserTypeInput = { ref: string; text: string; clear: boolean; submit: boolean }

/** 浏览器输入一次可接受的 UTF-16 单元数。 */
export const browserTypeTextLimit = 4096

/** 工作台输入在会话中使用的完整进程内工具名。 */
export const browserTypeToolName = "mcp__pigclaude_workbench__browser_type"

/** 主进程核验得到的真实地址和元素信息，供当前调用的审批卡使用。 */
export type BrowserPermissionContext =
  | { kind: "open"; url: string }
  | { kind: "snapshot" }
  | { kind: "navigate"; action: "url" | "back" | "forward" | "reload"; url: string }
  | { kind: "click"; url: string; ref: string; role: string; name: string }
  | {
      kind: "type"
      url: string
      ref: string
      role: string
      name: string
      isPassword: boolean
      characterCount?: number
      clear: boolean
      submit: boolean
    }
  | { kind: "screenshot"; url: string; width: number; height: number }

/** 工作台截图在会话中使用的完整进程内工具名。 */
export const browserScreenshotToolName = "mcp__pigclaude_workbench__browser_screenshot"
