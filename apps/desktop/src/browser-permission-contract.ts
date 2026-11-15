// 描述主进程为浏览器审批卡提供的工作台操作。

/** 主进程验证过的打开地址，或一次读取当前本机页面的操作。 */
export type BrowserPermissionContext = { kind: "open"; url: string } | { kind: "snapshot" }
