// 负责验证新会话按本机保存的默认设置初始化：输入框显示默认权限，启动会话带上默认权限和偏好账号；
// 偏好的账号已删除或默认模型不在目录里时，回到自动选择和 Claude Code 的默认模型。
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { typeAndSend } from "./test-support/chat-screen-harness"
import { desktopAppRoot, renderDesktopApp } from "./test-support/desktop-app-harness"
import { builtinSessionDefaults } from "../../session-defaults-contract"

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({
    resolved: "dark",
    settings: { smartPunctuation: false },
    update: () => undefined,
  }),
}))

const app = desktopAppRoot()

function permissionLabel(): string | null {
  const control = app.container.querySelector<HTMLElement>('.composer [aria-label*=": "]')
  return control?.getAttribute("aria-label") ?? null
}

describe("new session defaults", () => {
  it("starts a new session with the saved permission level and preferred account", async () => {
    const bridge = await renderDesktopApp(app, undefined, {
      model: null,
      permissionMode: "acceptEdits",
      accountId: "acc-work",
    })
    expect(permissionLabel()).toContain("接受编辑")

    await typeAndSend(app.container, "检查依赖")

    await vi.waitFor(() => expect(bridge.starts).toHaveLength(1))
    expect(bridge.starts[0]).toMatchObject({ permissionMode: "acceptEdits", accountId: "acc-work" })
  })

  it("falls back to automatic accounts and Claude Code's model when the saved ones are gone", async () => {
    const bridge = await renderDesktopApp(app, undefined, {
      ...builtinSessionDefaults,
      model: "claude-retired",
      accountId: "acc-deleted",
    })
    expect(permissionLabel()).toContain("监督审批")

    await typeAndSend(app.container, "检查依赖")

    await vi.waitFor(() => expect(bridge.starts).toHaveLength(1))
    expect(bridge.starts[0]).toMatchObject({ permissionMode: "default" })
    expect(bridge.starts[0]?.accountId).toBeUndefined()
    expect(bridge.starts[0]?.model).not.toBe("claude-retired")
  })
})
