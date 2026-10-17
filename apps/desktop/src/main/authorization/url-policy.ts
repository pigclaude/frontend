// 负责限制主进程可打开的授权服务 URL，避免 renderer 跳转到任意站点。

/** 校验授权地址是否与配置的 origin 和 /authorize 路径完全匹配。 */
export function isAllowedAuthorizationUrl(url: string, authOrigin: string): boolean {
  try {
    const candidate = new URL(url)
    const expected = new URL(authOrigin)
    return (
      candidate.protocol === expected.protocol &&
      candidate.host === expected.host &&
      candidate.pathname === "/authorize" &&
      candidate.username === "" &&
      candidate.password === ""
    )
  } catch {
    return false
  }
}
