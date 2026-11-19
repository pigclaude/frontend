// 负责官网登录表单按需取得新的服务端交互，并让同一页面里的请求共用续接结果。
import { webOidcStartPath } from "@pigclaude/api/web-oidc"
import { identityApi, type IdentityInteraction } from "./identity-api"

/** 用当前可用的交互发出一次请求，保留调用方的错误和结果类型。 */
export type RunIdentityRequest = <T>(
  request: (interaction: IdentityInteraction) => Promise<T>,
) => Promise<T>

function canRenew(view: IdentityInteraction): boolean {
  return (
    view.realm === "User" &&
    view.clientId === "pigclaude-home" &&
    view.phase === "login" &&
    view.restartUrl === `${window.location.origin}/login`
  )
}

async function restartHomeLogin(previous: IdentityInteraction): Promise<IdentityInteraction> {
  // 强制新登录交互，避免背景请求走进已有会话的回跳。
  const response = await fetch(webOidcStartPath({ site: "home", mode: "switch" }), {
    mode: "same-origin",
    credentials: "same-origin",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  })
  if (!response.ok || !response.redirected) throw new Error("无法重新发起网站登录")
  const url = new URL(response.url)
  const id = url.searchParams.get("interactionId")
  if (
    url.origin !== window.location.origin ||
    url.pathname !== "/identity/login" ||
    url.searchParams.get("realm") !== "User" ||
    !id ||
    id === previous.interactionId
  ) {
    throw new Error("网站登录入口未返回新交互")
  }
  const next = await identityApi.load(id, "User")
  if (!canRenew(next) || next.interactionId !== id || next.expiresAt * 1000 <= Date.now()) {
    throw new Error("新网站登录交互不可用")
  }
  return next
}

/** 按需续接同源官网登录阶段。每轮只发起一次新交互，凭据提交由调用方负责。 */
export function createIdentityInteractionRequests(initial: IdentityInteraction) {
  const renewOnExpiry = canRenew(initial)
  let current = initial
  let renewal: Promise<IdentityInteraction> | null = null

  const run: RunIdentityRequest = (request) => {
    if (!renewOnExpiry || current.expiresAt * 1000 > Date.now()) return request(current)

    renewal ??= restartHomeLogin(current)
      .then((next) => {
        current = next
        return next
      })
      .finally(() => {
        renewal = null
      })
    return renewal.then(request)
  }

  return { renewOnExpiry, run }
}
