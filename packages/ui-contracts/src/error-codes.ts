/**
 * Host 有专门说明的错误码：界面按码显示当前语言的解释，原始信息收起来备查。
 * 其余失败一律是 COMMAND_FAILED，界面原样显示信息。
 */
export const HOST_ERROR_CODES = [
  "GH_NOT_AVAILABLE",
  "GH_NOT_AUTHENTICATED",
  "GIT_NO_REMOTE",
  /** 删除还有会话在用的 Agent 实例。 */
  "AGENT_INSTANCE_IN_USE",
] as const

/** 有专门说明的 Host 错误码。 */
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number]

/** 判断一个值是不是有专门说明的 Host 错误码。 */
export function isHostErrorCode(value: unknown): value is HostErrorCode {
  return typeof value === "string" && (HOST_ERROR_CODES as readonly string[]).includes(value)
}
