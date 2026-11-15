// 从原生菜单的 Electron 调用核对导航、审批角标与通知提醒各自的生命周期。

import type { MenuItemConstructorOptions } from "electron"
import { expect, it, vi } from "vitest"
import { createDesktopTray } from "./desktop-tray"
import type { LiveSessionPreview } from "./session/session-summary"
import type { MembershipState } from "@pigclaude/contracts/membership"

const electron = vi.hoisted(() => ({
  beforeQuit: vi.fn(),
  template: [] as MenuItemConstructorOptions[],
  image: vi.fn(),
}))

vi.mock("electron", () => ({
  app: { quit: electron.beforeQuit },
  nativeImage: { createFromDataURL: (source: string) => ({ source, setTemplateImage() {} }) },
  Tray: class {
    setToolTip() {}
    on() {}
    setContextMenu() {}
    setImage(image: unknown) {
      electron.image(image)
    }
    destroy() {}
  },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      electron.template = template
      return {}
    },
  },
}))

it("审批项只导航，会员变化后旧新会话菜单也无法启动；打开和退出仍用原有流程", async () => {
  const show = vi.fn()
  const navigate = vi.fn()
  let membership: MembershipState = "active"
  const sessions: LiveSessionPreview[] = [
    { sessionId: "hidden-session", projectName: "test", title: null, pendingApprovals: 1 },
  ]
  const accounts = vi.fn(async () => [{ enabled: true, needsReauth: true }])
  const tray = createDesktopTray({
    openWindow: show,
    navigate,
    membership: () => membership,
    sessions: () => sessions,
    accounts,
  })
  expect(tray).not.toBeNull()
  const menuItem = (id: string) => electron.template.find((item) => item.id === id)
  const click = (item: MenuItemConstructorOptions | undefined) => {
    if (!item?.click) throw new Error("菜单项不可点击")
    Reflect.apply(item.click, undefined, [])
  }
  await vi.waitFor(() => expect(menuItem("accounts")?.label).toBe("Claude 账号需要处理（1）"))
  click(menuItem("accounts"))
  click(menuItem("approvals"))
  expect(navigate.mock.calls).toEqual([
    [{ kind: "accounts" }],
    [{ kind: "session", sessionId: "hidden-session" }],
  ])
  expect(electron.image).toHaveBeenCalledTimes(1)

  const newSession = menuItem("new-session")
  membership = "network_grace"
  tray?.refresh()
  expect(menuItem("new-session")).toBeUndefined()
  click(newSession)
  expect(navigate).toHaveBeenCalledTimes(2)
  expect(menuItem("membership")?.label).toBe("会员核验暂时失败")
  expect(menuItem("approvals")?.label).toBe("待审批（1）")

  tray?.setNotificationBadge(true)
  tray?.setNotificationBadge(false)
  expect(electron.image).toHaveBeenCalledTimes(1)
  tray?.setNotificationBadge(true)
  sessions.splice(0)
  tray?.sessionChanged("sessions-changed")
  expect(menuItem("approvals")).toMatchObject({ label: "待审批（0）", enabled: false })
  expect(electron.image).toHaveBeenCalledTimes(1)
  tray?.setNotificationBadge(false)
  expect(electron.image).toHaveBeenCalledTimes(2)
  expect(electron.image.mock.calls[0]?.[0]).not.toEqual(electron.image.mock.calls[1]?.[0])

  click(menuItem("open-window"))
  click(menuItem("quit"))
  expect(show).toHaveBeenCalledOnce()
  expect(electron.beforeQuit).toHaveBeenCalledOnce()
  tray?.destroy()
})
