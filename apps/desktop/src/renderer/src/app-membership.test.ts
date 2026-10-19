// 负责验证合并后的桌面入口同时保留浏览器外观预览和真实桌面的会员启动门禁。
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DesktopApp } from "./app"

const fixture = vi.hoisted(() => ({ appearance: { resolved: "dark" } }))

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => fixture.appearance,
}))

vi.mock("./main-window", () => ({
  MainWindow: ({
    screen,
    theme,
    appearance,
  }: {
    screen: string
    theme: string
    appearance: unknown
  }) =>
    createElement("main", {
      "data-screen": screen,
      "data-theme": theme,
      "data-appearance": appearance === fixture.appearance ? "ready" : "missing",
    }),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("desktop membership and appearance integration", () => {
  it("keeps a real desktop bridge behind membership checks even with DEV screen parameters", () => {
    vi.stubEnv("DEV", true)
    vi.stubGlobal("window", {
      location: { search: "?screen=appearance&theme=dark" },
      pigclaude: { membership: { inspect: vi.fn(), subscribe: vi.fn() } },
    })

    const markup = renderToStaticMarkup(createElement(DesktopApp))

    expect(markup).toContain("正在连接 Rust 授权服务")
    expect(markup).not.toContain('data-screen="appearance"')
  })

  it("retains DEV browser preview and forwards the appearance controller", () => {
    vi.stubEnv("DEV", true)
    vi.stubGlobal("window", { location: { search: "?screen=appearance&theme=dark" } })

    const markup = renderToStaticMarkup(createElement(DesktopApp))

    expect(markup).toContain('data-screen="appearance"')
    expect(markup).toContain('data-theme="dark"')
    expect(markup).toContain('data-appearance="ready"')
  })

  it("rejects screen preview parameters outside DEV even without a desktop bridge", () => {
    vi.stubEnv("DEV", false)
    vi.stubGlobal("window", { location: { search: "?screen=appearance&theme=dark" } })

    const markup = renderToStaticMarkup(createElement(DesktopApp))

    expect(markup).toContain("正在连接 Rust 授权服务")
    expect(markup).not.toContain('data-screen="appearance"')
  })
})
