// 负责把主进程错误码和 Electron 包装后的错误文本映射成界面中文文案；
// 未知错误码保留原始描述，usage_write_failed 只作为警告。

/** 界面展示的错误；warning 表示不终止会话的提示。 */
export type SessionErrorView = {
  code: string
  message: string
  warning: boolean
}

const errorTexts: Record<string, string> = {
  MEMBERSHIP_REQUIRED: "会员状态不可用，请重新登录",
  WORKSPACE_UNAVAILABLE: "工作区不存在或不可读",
  NO_AVAILABLE_ACCOUNT: "没有可用的 Claude 账号，请添加或重新授权",
  CLAUDE_RUNTIME_UNAVAILABLE: "Claude Code 不可用，请检查安装",
  DAEMON_UNAVAILABLE: "本机中继尚未就绪",
  PROXY_UNAVAILABLE: "账号代理不可用，请检查代理",
  NETWORK_UNAVAILABLE: "网络请求失败，请检查系统网络或代理",
  AUTH_EXPIRED: "账号凭据失效，请重新授权",
  PERMISSION_TIMEOUT: "权限询问超时，已拒绝",
  QUESTION_TIMEOUT: "提问超时，已拒绝",
  SESSION_ALREADY_ACTIVE: "已有活动会话",
  SESSION_CANCELLED: "已取消当前请求",
  SESSION_NOT_FOUND: "会话不存在或已结束",
  SDK_ERROR: "Claude 返回错误",
  SESSION_START_FAILED: "会话启动失败，请检查工作区和网络",
  usage_write_failed: "用量记录写入失败，不影响会话",
}

const remotePrefix = /^Error invoking remote method '[^']*': (?:\w*Error: )?/

/** 把一条原始错误文本解析成错误码、中文文案和是否只是警告。 */
export function sessionErrorView(input: string): SessionErrorView {
  const value = input.trim().replace(remotePrefix, "")
  const match = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*([\s\S]*)$/.exec(value)
  const code = match?.[1] ?? ""
  const detail = match?.[2]?.trim() ?? ""
  const known = errorTexts[code]
  if (known !== undefined) {
    return { code, message: known, warning: code === "usage_write_failed" }
  }
  if (code !== "" && detail !== "") {
    return { code, message: detail, warning: false }
  }
  return { code: code || "SDK_ERROR", message: value || "会话操作失败", warning: false }
}

/** 只返回错误对应的中文文案；未知错误码保留主进程给的描述。 */
export function sessionErrorText(input: string): string {
  return sessionErrorView(input).message
}
