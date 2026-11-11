// 负责把主进程里的未知错误转换成不会泄露敏感细节的用户可见消息。

/** 把未知错误转换成稳定的授权服务错误文案。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "授权服务不可用"
}
