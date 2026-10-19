// 负责在无浏览器与网络的本地传输夹具中验证真实共享提交编排，不调用生产服务。
import { test, expect } from "@playwright/test"
import { performSubmission, type SubmissionPort } from "./turnstile-production-support"

function fixture(method: string, body: unknown) {
  const events: string[] = []
  const port: SubmissionPort = {
    ready: async () => {
      events.push("ready")
    },
    observe: (matches) => {
      events.push("observe")
      return new Promise((resolve, reject) => {
        port.click = async () => {
          events.push("click")
          const url =
            "https://admin.pigclaude.com/admin/v1/settings/turnstile/" +
            (method === "PUT" ? "draft" : "activate")
          if (!matches(url, method)) reject(new Error("响应匹配失败"))
          else resolve({ status: 200, body })
        }
      })
    },
    click: async () => {
      throw new Error("未在点击前安装监听器")
    },
  }
  return { port, events }
}

test("PUT草稿无proof成功且先监听后点击", async () => {
  const { port, events } = fixture("PUT", { expectedRevision: "8", enabled: true })
  await expect(
    performSubmission(
      port,
      "https://admin.pigclaude.com",
      "/admin/v1/settings/turnstile/draft",
      200,
    ),
  ).resolves.toBeUndefined()
  expect(events).toEqual(["ready", "observe", "click"])
})
test("POST启用需要新proof并拒绝缺失或重复proof", async () => {
  const path = "/admin/v1/settings/turnstile/activate"
  await expect(
    performSubmission(
      fixture("POST", { captchaToken: "local-new-proof" }).port,
      "https://admin.pigclaude.com",
      path,
      200,
      "local-old-proof",
    ),
  ).resolves.toBe("local-new-proof")
  for (const body of [{}, { captchaToken: "local-old-proof" }]) {
    await expect(
      performSubmission(
        fixture("POST", body).port,
        "https://admin.pigclaude.com",
        path,
        200,
        "local-old-proof",
      ),
    ).rejects.toThrow("提交证明边界无效")
  }
})
test("PUT草稿拒绝携带proof且不更新上一认证proof", async () => {
  await expect(
    performSubmission(
      fixture("PUT", { captchaToken: "local-proof" }).port,
      "https://admin.pigclaude.com",
      "/admin/v1/settings/turnstile/draft",
      200,
    ),
  ).rejects.toThrow("提交证明边界无效")
})
