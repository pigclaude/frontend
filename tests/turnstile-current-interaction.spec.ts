// 负责核验当前OP上下文必须来自同浏览器读取，错误页面或响应在proof消费前拒绝。
import { test, expect, type Page } from "@playwright/test"
import { readPasswordInteraction } from "./turnstile-current-interaction"

test("从当前页面交互GET取得服务器CSRF，不从URL伪造", async () => {
  const requests: string[] = []
  const page = {
    url: () =>
      "https://www.pigclaude.com/identity/login?interactionId=local-id&realm=Admin&csrf=attacker",
    request: {
      get: async (url: string) => {
        requests.push(url)
        return {
          status: () => 200,
          json: async () => ({
            interactionId: "local-id",
            realm: "Admin",
            csrf: "server-csrf",
            phase: "login",
          }),
        }
      },
    },
  } as unknown as Page
  const view = await readPasswordInteraction(page)
  expect(view.csrf).toBe("server-csrf")
  expect(view.realm).toBe("Admin")
  expect(requests).toEqual([
    "https://www.pigclaude.com/v1/identity/interactions/local-id?realm=Admin",
  ])
})
test("非中央页面和缺失服务器CSRF均不能形成提交上下文", async () => {
  for (const url of [
    "https://pigclaude.com/identity/login?interactionId=x&realm=User",
    "https://www.pigclaude.com/login",
  ]) {
    let requests = 0
    const page = {
      url: () => url,
      request: {
        get: async () => {
          requests++
          throw new Error("unexpected")
        },
      },
    } as unknown as Page
    await expect(readPasswordInteraction(page)).rejects.toThrow("当前页面没有OP交互")
    expect(requests).toBe(0)
  }
  const page = {
    url: () => "https://www.pigclaude.com/identity/login?interactionId=x&realm=User",
    request: {
      get: async () => ({
        status: () => 200,
        json: async () => ({ interactionId: "x", realm: "User", phase: "login" }),
      }),
    },
  } as unknown as Page
  await expect(readPasswordInteraction(page)).rejects.toThrow("OP交互响应无效")
})
