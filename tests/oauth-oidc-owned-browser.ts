// 负责让本任务worker只连接顶层owner浏览器，并固定化含秘密WS地址的连接/关闭失败。
import { chromium, test as base } from "@playwright/test"

/** 浏览器由顶层owner持有；worker不启动browser，也不把WS控制能力交给失败reporter。 */
export const test = base.extend({
  browser: [
    async ({ browserName }, use) => {
      const endpoint = process.env["OAUTH_TEST_BROWSER_WS"]
      let valid = false
      try {
        const url = new URL(endpoint ?? "")
        valid =
          browserName === "chromium" &&
          url.protocol === "ws:" &&
          url.hostname === "127.0.0.1" &&
          !!url.port &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname !== "/"
      } catch {
        /* 缺失或非法能力只返回固定失败。 */
      }
      if (!valid || !endpoint) throw new Error("OAUTH_TEST_BROWSER_SUPERVISION_REQUIRED")
      const browser = await chromium.connect(endpoint, { timeout: 10000 }).catch(() => {
        throw new Error("OAUTH_TEST_BROWSER_CONNECT_FAILED")
      })
      try {
        await use(browser)
      } finally {
        await browser.close().catch(() => {
          throw new Error("OAUTH_TEST_BROWSER_DISCONNECT_FAILED")
        })
      }
    },
    { scope: "worker" },
  ],
})
