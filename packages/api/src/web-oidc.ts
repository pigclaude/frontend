// 负责受信同源网站 OIDC 入口、一次性注册 UI 意图和脱敏会话类型。
/** 网站登录 UI 意图，不作为认证或 realm 证明。 */
export interface WebOidcLogin {
  site: "home" | "admin"
  returnTo?: string
  mode?: "login" | "register"
}
const registrationHintKey = "pigclaude:registration-ui"
const hintLifetime = 600_000

/** 顶层导航只接收固定 RP start 或已验证服务器接续。 */
export const webOidcNavigation = {
  assign: (url: string) => window.location.assign(url),
  replace: (url: string) => window.location.replace(url),
}

/** 返回固定同源 RP start；原 returnTo 只编码一次，由服务器验证路径。 */
export function webOidcStartPath(input: WebOidcLogin): string {
  const prefix = input.site === "admin" ? "/admin" : ""
  const params = new URLSearchParams({ returnTo: input.returnTo ?? "/account" })
  // 注册必须进入本地中央表单，不能被已有 OP SSO 静默跳过。
  if (input.site === "home" && input.mode === "register") params.set("maxAge", "0")
  return `${prefix}/v1/web/oidc/start?${params}`
}

/** 通过顶层导航进入服务器 RP；replace 为 true 时不在历史里留下中转页。注册意图只保存一次性非敏感 UI hint。 */
export function beginWebOidcLogin(input: WebOidcLogin, options: { replace?: boolean } = {}): void {
  try {
    sessionStorage.removeItem(registrationHintKey)
    if (input.site === "home" && input.mode === "register") {
      sessionStorage.setItem(
        registrationHintKey,
        JSON.stringify({ mode: "register", createdAt: Date.now() }),
      )
    }
  } catch {
    // 存储不可用只影响初始标签，不影响 RP 导航。
  }
  const url = webOidcStartPath(input)
  if (options.replace) webOidcNavigation.replace(url)
  else webOidcNavigation.assign(url)
}

/** 消费一次性注册意图；损坏、过期、未来时间和存储异常一律默认登录。 */
export function consumeRegistrationHint(): boolean {
  try {
    const raw = sessionStorage.getItem(registrationHintKey)
    sessionStorage.removeItem(registrationHintKey)
    if (!raw) return false
    const hint: unknown = JSON.parse(raw)
    if (typeof hint !== "object" || hint === null || !("mode" in hint) || !("createdAt" in hint))
      return false
    return (
      hint.mode === "register" &&
      typeof hint.createdAt === "number" &&
      Number.isFinite(hint.createdAt) &&
      hint.createdAt <= Date.now() &&
      Date.now() - hint.createdAt < hintLifetime
    )
  } catch {
    return false
  }
}

/** RP bootstrap 仅返回当前主体和 session 绑定 CSRF，不含 OAuth 令牌。 */
export interface WebSessionBootstrap {
  principalId: string
  principalType: "User" | "Admin"
  authVersion: string | null
  csrf: string
  permissions: string[]
}

/** 网站会话代次只在本地退出时递增，用于丢弃旧 HTTP 和 UI 结果。 */
export function createWebSessionGeneration() {
  let value = 0
  return {
    /** 读取请求开始时的会话代次。 */
    current: () => value,
    /** 退出确认后撤销所有已发请求的交付资格。 */
    invalidate: () => {
      value += 1
    },
  }
}
