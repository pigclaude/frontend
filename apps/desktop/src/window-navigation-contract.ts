// 定义原生系统入口能请求主窗口打开的位置；只携带导航所需的数据。

/** 从托盘或通知送到主窗口的导航命令。 */
export type WindowNavigationCommand =
  { kind: "session"; sessionId: string } | { kind: "new-session" } | { kind: "accounts" }

/** 主窗口从主进程取走待处理导航。 */
export const takeWindowNavigationChannel = "pigclaude:window-navigation-take"
/** 告知窗口有新导航；事件本身不含数据。 */
export const windowNavigationAvailableChannel = "pigclaude:window-navigation-available"

/** 只接受原生入口支持的位置和有界的会话 id。 */
export function isWindowNavigationCommand(value: unknown): value is WindowNavigationCommand {
  if (!value || typeof value !== "object" || !("kind" in value)) return false
  return (
    value.kind === "accounts" ||
    value.kind === "new-session" ||
    (value.kind === "session" &&
      "sessionId" in value &&
      typeof value.sessionId === "string" &&
      value.sessionId.length > 0 &&
      value.sessionId.length <= 200)
  )
}
