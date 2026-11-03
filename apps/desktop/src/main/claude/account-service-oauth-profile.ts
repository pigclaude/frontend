// 负责读取可选的 Claude 账号资料，保持导入时已有的错误处理行为。

import type { ClaudeOAuthProfile } from "./subscription-oauth"

/** 读取可选账号资料；读取失败时返回 null。 */
export async function readOptionalOAuthProfile(
  read: () => Promise<ClaudeOAuthProfile | null>,
): Promise<ClaudeOAuthProfile | null> {
  try {
    return await read()
  } catch {
    return null
  }
}
