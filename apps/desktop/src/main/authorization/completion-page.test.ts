// 验证共享授权完成页的品牌内容、转义和响应头。
import type { ServerResponse } from "node:http"
import { describe, expect, it } from "vitest"
import { renderCompletionPage, sendCompletionPage } from "./completion-page"

describe("renderCompletionPage", () => {
  it("renders a branded success page without external resources", () => {
    const html = renderCompletionPage({
      kind: "success",
      title: "授权完成",
      message: "PigClaude 已收到授权，可以关闭此页面继续。",
      hint: "如果没有自动切回，请手动关闭此标签页。",
    })
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("PigClaude")
    expect(html).toContain("授权完成")
    expect(html).toContain("可以关闭此页面继续")
    expect(html).toContain('class="status success"')
    expect(html).not.toContain("http://")
    expect(html).not.toContain("https://")
  })

  it("renders the error variant and escapes dynamic text", () => {
    const html = renderCompletionPage({
      kind: "error",
      title: "授权未完成",
      message: `失败 <script>alert("x")</script>`,
      hint: "请回到 PigClaude 重新发起授权。",
    })
    expect(html).toContain('class="status error"')
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>alert")
  })
})

describe("sendCompletionPage", () => {
  it("sets no-store, nosniff and CSP headers", () => {
    const headers: Record<string, string> = {}
    let status = 0
    let body = ""
    const response = {
      set statusCode(value: number) {
        status = value
      },
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value
      },
      end(value?: string) {
        body = value ?? ""
      },
    } as unknown as ServerResponse

    sendCompletionPage(
      response,
      { kind: "error", title: "授权未完成", message: "授权回调处理失败。" },
      500,
    )

    expect(status).toBe(500)
    expect(headers["content-type"]).toContain("text/html")
    expect(headers["cache-control"]).toBe("no-store")
    expect(headers["x-content-type-options"]).toBe("nosniff")
    expect(headers["referrer-policy"]).toBe("no-referrer")
    expect(headers["content-security-policy"]).toContain("default-src 'none'")
    expect(body).toContain("授权未完成")
  })
})
