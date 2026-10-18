// 负责集中定义管理后台在本地开发时连接 Rust server 的 loopback 默认值。

/** Task 7 Rust server 的默认 HTTP listener，保持所有本地服务只绑定 loopback。 */
export const DEFAULT_RUST_API_TARGET = "http://127.0.0.1:8788"

/** 官网独立应用的常规本地地址，不指回管理后台 SPA。 */
export const DEFAULT_HOME_ORIGIN = "http://127.0.0.1:3000"

/** 仅将公开配置中的 HTTP(S) 无凭据 origin 用于官网导航，其余回退本地官网。 */
export function resolveHomeOrigin(value: string | undefined): string {
  if (!value) return DEFAULT_HOME_ORIGIN
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return DEFAULT_HOME_ORIGIN
    }
    return url.origin
  } catch {
    return DEFAULT_HOME_ORIGIN
  }
}
