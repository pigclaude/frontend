// 负责从当前OP页面及同一浏览器会话取得可信交互，禁止伪造CSRF或旧密码Cookie入口。
import type { Page } from "@playwright/test"
import type { IdentityInteraction } from "../apps/home/src/lib/identity-api"

/** 已由当前浏览器从OP取得的密码交互上下文；不写日志或证据。 */
export type PasswordInteraction = Pick<
  IdentityInteraction,
  "interactionId" | "realm" | "csrf" | "phase"
>

/** 校验当前OP上下文并生成唯一路径，不接受任意目标URL。 */
export function passwordPath(
  view: PasswordInteraction,
): `/v1/identity/interactions/${string}/password` {
  if (
    !view ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(view.interactionId) ||
    !view.csrf ||
    view.phase !== "login" ||
    !["User", "Admin"].includes(view.realm)
  )
    throw new Error("当前OP密码交互不可用")
  return `/v1/identity/interactions/${encodeURIComponent(view.interactionId)}/password`
}

/** 读取实际中央页面指向的交互，沿用浏览器Cookie并仅接受固定canonical OP。 */
export async function readPasswordInteraction(page: Page): Promise<PasswordInteraction> {
  const url = new URL(page.url())
  const id = url.searchParams.get("interactionId")
  const realm = url.searchParams.get("realm")
  if (
    url.origin !== "https://www.pigclaude.com" ||
    !["/identity/login", "/identity/authorize"].includes(url.pathname) ||
    !id ||
    !["User", "Admin"].includes(realm ?? "")
  )
    throw new Error("当前页面没有OP交互")
  const response = await page.request.get(
    `${url.origin}/v1/identity/interactions/${encodeURIComponent(id)}?realm=${realm}`,
  )
  if (response.status() !== 200) throw new Error("OP交互读取失败")
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") throw new Error("OP交互响应无效")
  const v = value as Record<string, unknown>
  if (
    v.interactionId !== id ||
    v.realm !== realm ||
    typeof v.csrf !== "string" ||
    v.phase !== "login"
  )
    throw new Error("OP交互响应无效")
  const view: PasswordInteraction = {
    interactionId: id,
    realm: realm as "User" | "Admin",
    csrf: v.csrf,
    phase: "login",
  }
  passwordPath(view)
  return view
}
