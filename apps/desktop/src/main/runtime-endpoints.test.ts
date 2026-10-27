// 负责验证安装包公共端点、显式环境覆盖和无凭据 URL 的启动边界。
import { describe, expect, it } from "vitest"
import { readDesktopRuntimeEndpoints } from "./runtime-endpoints"

const metadata = {
  pigclaudeEndpoints: {
    rustBaseUrl: "http://127.0.0.1:65533",
    authOrigin: "http://127.0.0.1:65534",
  },
}

describe("桌面公共端点", () => {
  it("在没有 shell 环境时读取 bundle 的公共端点", () => {
    expect(readDesktopRuntimeEndpoints({}, metadata)).toEqual({
      ...metadata.pigclaudeEndpoints,
      websiteOrigin: metadata.pigclaudeEndpoints.authOrigin,
    })
  })

  it("保留显式环境覆盖与旧本地默认地址", () => {
    expect(readDesktopRuntimeEndpoints({})).toEqual({
      rustBaseUrl: "http://127.0.0.1:8788",
      authOrigin: "http://127.0.0.1:3000",
      websiteOrigin: "http://127.0.0.1:3000",
    })
    expect(
      readDesktopRuntimeEndpoints(
        { PIGCLAUDE_AUTH_ORIGIN: "https://login.example.test/" },
        metadata,
      ),
    ).toEqual({
      rustBaseUrl: metadata.pigclaudeEndpoints.rustBaseUrl,
      authOrigin: "https://login.example.test",
      websiteOrigin: "https://login.example.test",
    })
  })

  it.each([
    "file:///tmp/auth",
    "javascript:alert(1)",
    "https://user:secret@example.test",
    "https://example.test/authorize",
    "https://example.test?token=secret",
    "https://example.test#secret",
    "https://example.test?",
    "https://example.test#",
    "https://example.test/a/..",
    "https://exam\nple.test",
    " https://example.test",
    "",
  ])("拒绝不是纯 HTTP(S) origin 的端点 %s", (endpoint) => {
    expect(() => readDesktopRuntimeEndpoints({ PIGCLAUDE_AUTH_ORIGIN: endpoint })).toThrow()
    expect(() => readDesktopRuntimeEndpoints({ PIGCLAUDE_RUST_BASE_URL: endpoint })).toThrow()
    expect(() => readDesktopRuntimeEndpoints({ PIGCLAUDE_WEBSITE_ORIGIN: endpoint })).toThrow()
  })

  it("拒绝损坏的 bundle 配置，防止静默连错服务", () => {
    expect(() => readDesktopRuntimeEndpoints({}, { pigclaudeEndpoints: null })).toThrow()
    expect(() => readDesktopRuntimeEndpoints({}, { pigclaudeEndpoints: {} })).toThrow()
  })

  it("网站可使用独立公共地址，并保留环境覆盖优先级", () => {
    const configured = {
      pigclaudeEndpoints: {
        ...metadata.pigclaudeEndpoints,
        websiteOrigin: "https://members.example.test",
      },
    }
    expect(readDesktopRuntimeEndpoints({}, configured).websiteOrigin).toBe(
      "https://members.example.test",
    )
    expect(
      readDesktopRuntimeEndpoints({ PIGCLAUDE_WEBSITE_ORIGIN: "http://127.0.0.1:3010" }, configured)
        .websiteOrigin,
    ).toBe("http://127.0.0.1:3010")
  })
})
