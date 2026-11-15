// 将会话、账号与会员状态接到原生托盘；唤回、导航和退出都沿用主窗口的入口。

import { isDeepStrictEqual } from "node:util"
import { app, Menu, Tray, type MenuItemConstructorOptions } from "electron"
import type { MembershipState } from "@pigclaude/contracts/membership"
import type { WindowNavigationCommand } from "../window-navigation-contract"
import type { LiveSessionPreview } from "./session/session-summary"
import type { SessionHostEvent } from "./session/session-types"
import { createTrayImages } from "./tray-images"
import {
  buildTrayMenu,
  type TrayAccount,
  type TrayMenuAction,
  type TrayMenuItem,
} from "./tray-menu"

type DesktopTrayOptions = {
  openWindow: () => void
  navigate: (command: WindowNavigationCommand) => void
  membership: () => MembershipState
  sessions: () => readonly LiveSessionPreview[]
  accounts: () => Promise<readonly TrayAccount[]>
}

const sessionChanges = new Set<SessionHostEvent["type"]>([
  "sessions-changed",
  "permission",
  "turn-started",
  "turn-ended",
  "ended",
])

class DesktopTray {
  #accounts: readonly TrayAccount[] = []
  #accountRead = 0
  #cooldownTimer: ReturnType<typeof setTimeout> | undefined
  #menu: readonly TrayMenuItem[] = []
  #marked = false
  #notificationBadge = false
  #destroyed = false

  constructor(
    private readonly tray: Tray,
    private readonly images: ReturnType<typeof createTrayImages>,
    private readonly options: DesktopTrayOptions,
  ) {}

  /** 从当前权威状态刷新菜单和待审批角标，只更新变更的原生属性。 */
  refresh(): void {
    if (this.#destroyed) return
    const { items, pendingApprovals } = buildTrayMenu({
      membership: this.options.membership(),
      sessions: this.options.sessions(),
      accounts: this.#accounts,
      now: Date.now(),
    })
    if (!isDeepStrictEqual(this.#menu, items)) {
      this.tray.setContextMenu(Menu.buildFromTemplate(this.#template(items)))
      this.tray.setToolTip(
        pendingApprovals > 0 ? `PigClaude · 待审批 ${pendingApprovals}` : "PigClaude",
      )
      this.#menu = items
    }
    const marked = this.#notificationBadge || pendingApprovals > 0
    if (this.#marked !== marked) {
      this.tray.setImage(marked ? this.images.marked : this.images.normal)
      this.#marked = marked
    }
  }

  /** 会话的生命周期、回合或审批变化会刷新菜单。流式正文不会触发刷新。 */
  sessionChanged(event: SessionHostEvent["type"]): void {
    if (sessionChanges.has(event)) this.refresh()
  }

  /** 保存账号后重新读取摘要；更晚的状态会覆盖较早的读取。 */
  accountsChanged(): void {
    const read = ++this.#accountRead
    void this.options
      .accounts()
      .then((accounts) => {
        if (this.#destroyed || read !== this.#accountRead) return
        this.#accounts = accounts.map(({ enabled, needsReauth, exhaustedUntil }) => ({
          enabled,
          needsReauth,
          ...(exhaustedUntil === undefined ? {} : { exhaustedUntil }),
        }))
        this.#updateCooldownTimer()
      })
      .catch(() => undefined)
  }

  /** 系统通知失败时单独设置提醒点；清除此提醒后仍保留待审批提醒。 */
  setNotificationBadge(active: boolean): void {
    this.#notificationBadge = active
    this.refresh()
  }

  /** 释放原生托盘与额度冷却计时器；忽略迟到的账号读取。 */
  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    clearTimeout(this.#cooldownTimer)
    this.tray.destroy()
  }

  #updateCooldownTimer(): void {
    clearTimeout(this.#cooldownTimer)
    this.refresh()
    const now = Date.now()
    const delay = this.#accounts.reduce((next, account) => {
      if (!account.enabled || account.needsReauth || !account.exhaustedUntil) return next
      const remaining = Date.parse(account.exhaustedUntil) - now
      return remaining > 0 ? Math.min(next, remaining) : next
    }, Infinity)
    if (Number.isFinite(delay))
      this.#cooldownTimer = setTimeout(
        () => this.#updateCooldownTimer(),
        Math.min(delay, 2 ** 31 - 1),
      )
  }

  #template(items: readonly TrayMenuItem[]): MenuItemConstructorOptions[] {
    return items.map((item) => {
      if ("type" in item) return { type: "separator" }
      const { id, action, submenu } = item
      // Windows 原生菜单用 & 标记助记键；项目名里的 & 按字面显示。
      const label = process.platform === "win32" ? item.label.replaceAll("&", "&&") : item.label
      if (submenu) return { id, label, submenu: this.#template(submenu) }
      if (!action) return { id, label, enabled: false }
      return { id, label, click: () => this.#activate(action) }
    })
  }

  #activate(action: TrayMenuAction): void {
    if (this.#destroyed) return
    if (action.kind === "open-window") this.options.openWindow()
    else if (action.kind === "quit") app.quit()
    else if (action.kind !== "new-session" || this.options.membership() === "active")
      this.options.navigate(action)
  }
}

/** 就绪后创建原生托盘；没有可用托盘时保留原来的关闭窗口行为。 */
export function createDesktopTray(options: DesktopTrayOptions): DesktopTray | null {
  let nativeTray: Tray | null = null
  try {
    const images = createTrayImages()
    nativeTray = new Tray(images.normal)
    nativeTray.on("click", options.openWindow)
    const tray = new DesktopTray(nativeTray, images, options)
    tray.refresh()
    tray.accountsChanged()
    return tray
  } catch {
    nativeTray?.destroy()
    return null
  }
}
