// 负责中央身份组件测试的公开交互和 HTTP 响应。
import type { IdentityInteraction } from "@/lib/identity-api"
/** 提供不含身份凭据的 User 交互。 */
export function interaction(overrides: Partial<IdentityInteraction> = {}): IdentityInteraction {
  return {
    interactionId: "interaction-1",
    realm: "User",
    clientId: "pigclaude-home",
    scopes: ["openid", "user:read"],
    phase: "login",
    csrf: "csrf-marker",
    expiresAt: 4102444800,
    registrationAllowed: true,
    providers: ["google", "github"],
    account: null,
    device: null,
    restartUrl: "https://www.pigclaude.com/login",
    ...overrides,
  }
}
/** 模拟 HTTP JSON 边界，不模拟组件内部状态。 */
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
