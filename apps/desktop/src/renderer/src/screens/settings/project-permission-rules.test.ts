// 验证会话设置可以定位项目授权，并在主进程确认撤销后移除权限条目。

// @vitest-environment jsdom
import { LocaleProvider } from "@pigclaude/ui-primitives"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import {
  projectPermissionCleanupFailed,
  type ProjectPermissionsBridge,
} from "../../../../project-permissions-contract"
import { SessionSettings } from "./settings-app-pages"

it.each(["clean", "cleanup failed"] as const)("撤销后刷新项目授权列表（%s）", async (result) => {
  const bridge: ProjectPermissionsBridge = {
    list: vi
      .fn()
      .mockResolvedValueOnce([
        { id: "permission-a", kind: "allow", value: "Bash(pnpm test)", projectPath: "/repo/app" },
      ])
      .mockResolvedValue([]),
    revoke:
      result === "clean"
        ? vi.fn().mockResolvedValue([])
        : vi.fn().mockRejectedValue(new Error(projectPermissionCleanupFailed)),
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("pigclaude", { session: { projectPermissions: bridge } })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        createElement(LocaleProvider, {
          locale: "zh-CN",
          children: createElement(SessionSettings, {}),
        }),
      ),
    )
    expect(container.textContent).toContain("项目授权")
    expect(container.textContent).toContain("Bash(pnpm test)")
    expect(container.textContent).toContain("/repo/app")
    const revoke = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "撤销",
    )
    if (!revoke) throw new Error("缺少撤销操作")
    await act(async () => revoke.click())
    expect(bridge.revoke).toHaveBeenCalledExactlyOnceWith("permission-a")
    expect(container.textContent).not.toContain("Bash(pnpm test)")
    expect(container.textContent).toContain("没有已保存的项目授权")
    if (result === "cleanup failed") {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("会话未能完成停放")
    } else expect(container.querySelector('[role="alert"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
