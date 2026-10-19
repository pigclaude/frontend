// 负责限制主进程可打开的授权服务 URL，避免 renderer 跳转到任意站点。

/** 校验授权地址是否与配置 origin 和 Rust 的授权入口路径匹配。 */
export function isAllowedAuthorizationUrl(url: string, authOrigin: string): boolean {
  try {
    const candidate = new URL(url)
    const expected = new URL(authOrigin)
    return (
      candidate.protocol === expected.protocol &&
      candidate.host === expected.host &&
      candidate.pathname === "/oauth2/authorize" &&
      candidate.username === "" &&
      candidate.password === "" &&
      candidate.hash === ""
    )
  } catch {
    return false
  }
}
