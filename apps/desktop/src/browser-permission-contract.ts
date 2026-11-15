// 描述主进程为浏览器审批卡提供的工作台操作。

/** 浏览器可请求的主帧导航意向，由主进程解析成实际本机目标。 */
export type BrowserNavigationTarget = { url: string } | { action: "back" | "forward" | "reload" }

/** 主进程核验得到的真实地址和元素信息，供当前调用的审批卡使用。 */
export type BrowserPermissionContext =
  | { kind: "open"; url: string }
  | { kind: "snapshot" }
  | { kind: "navigate"; action: "url" | "back" | "forward" | "reload"; url: string }
  | { kind: "click"; url: string; ref: string; role: string; name: string }
