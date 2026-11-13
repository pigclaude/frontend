// 验证外壳命令登记到 Command 扩展点：只有新会话、侧栏、设置、添加项目四条，没有 Pigcode 的插件命令，注销后清空。
import { describe, expect, it, vi } from "vitest"
import { createExtensionRegistry } from "@pigclaude/client-runtime"
import { registerShellCommands } from "./shell-commands"

function actions() {
  return {
    onNewSession: vi.fn(),
    onToggleSidebar: vi.fn(),
    onSettings: vi.fn(),
    onAddProject: vi.fn(),
  }
}

describe("registerShellCommands", () => {
  it("按顺序登记四条命令，新会话排在最前", () => {
    const registry = createExtensionRegistry()
    registerShellCommands(registry, actions(), (key) => key)
    expect(registry.get("command").map((command) => command.id)).toEqual([
      "new-thread",
      "toggle-sidebar",
      "settings",
      "add-project",
    ])
  })

  it("执行命令时调用对应的动作", () => {
    const registry = createExtensionRegistry()
    const handlers = actions()
    registerShellCommands(registry, handlers, (key) => key)
    for (const command of registry.get("command")) void command.run()
    expect(handlers.onNewSession).toHaveBeenCalledTimes(1)
    expect(handlers.onToggleSidebar).toHaveBeenCalledTimes(1)
    expect(handlers.onSettings).toHaveBeenCalledTimes(1)
    expect(handlers.onAddProject).toHaveBeenCalledTimes(1)
  })

  it("注销后命令面板里没有这些命令", () => {
    const registry = createExtensionRegistry()
    const dispose = registerShellCommands(registry, actions(), (key) => key)
    dispose()
    expect(registry.get("command")).toEqual([])
  })
})
