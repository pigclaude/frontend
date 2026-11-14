// 验证主界面的内容安全策略：脚本只能来自应用自身，不允许 eval、内联脚本和远程代码。
import { describe, expect, it } from "vitest"
import { rendererContentSecurityPolicy } from "./renderer-csp"

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0])
      .map(([name, ...sources]) => [name ?? "", sources]),
  )
}

describe("主界面 CSP", () => {
  const policy = directives(rendererContentSecurityPolicy())

  it("脚本只能来自应用自身，不允许 eval、内联脚本和远程地址", () => {
    expect(policy.get("default-src")).toEqual(["'self'"])
    expect(policy.get("script-src")).toEqual(["'self'"])
  })

  it("不加载插件对象和框架，不改写基准地址，也不提交表单", () => {
    expect(policy.get("object-src")).toEqual(["'none'"])
    expect(policy.get("frame-src")).toEqual(["'none'"])
    expect(policy.get("base-uri")).toEqual(["'none'"])
    expect(policy.get("form-action")).toEqual(["'none'"])
  })

  it("页面不发网络请求", () => {
    expect(policy.get("connect-src")).toEqual(["'self'"])
  })

  it("保留现有界面需要的样式和图片来源", () => {
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"])
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "http:", "https:"])
    expect(policy.get("font-src")).toEqual(["'self'", "data:"])
  })
})
