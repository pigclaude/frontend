// 负责验证 home 默认反向代理与 Rust 服务监听地址保持一致。
import { afterEach, describe, expect, it, vi } from "vitest"

describe("home Next.js proxy", () => {
  const originalApiTarget = process.env.API_PROXY_TARGET

  afterEach(() => {
    if (originalApiTarget === undefined) delete process.env.API_PROXY_TARGET
    else process.env.API_PROXY_TARGET = originalApiTarget
  })

  it("uses the Rust server default loopback address", async () => {
    delete process.env.API_PROXY_TARGET
    vi.resetModules()
    const { default: nextConfig } = await import("../../next.config")
    const rewrites = await nextConfig.rewrites?.()
    expect(rewrites).toEqual([
      {
        source: "/v1/:path*",
        destination: "http://127.0.0.1:8788/v1/:path*",
      },
    ])
  })
})
