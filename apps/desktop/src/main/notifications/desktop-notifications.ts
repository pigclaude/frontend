// 把后台通知连接到 Electron 系统通知、本机会话索引与项目显示名。

import { join } from "node:path"
import { app, Notification } from "electron"
import { appId } from "../../../electron-builder.json"
import { ProjectNameStore } from "../runtime/project-names"
import type { SessionEnvelope } from "../session/session-envelope"
import type { SessionStore } from "../session/session-store"
import type { NotificationSession } from "./background-notification"
import {
  createBackgroundNotifications,
  type BackgroundNotificationPorts,
} from "./background-notifications"

// 保留最近 20 条原生通知的点击句柄；系统静默清除通知时可能不发关闭事件。
const retainedNotificationLimit = 20

type DesktopNotificationPorts = Omit<BackgroundNotificationPorts, "show"> & { userDataPath: string }

/** 创建本机通知适配器，原生对象保留到关闭、点击或失败，退出时统一销毁。 */
export function createDesktopNotifications(ports: DesktopNotificationPorts) {
  // NSIS 用同一个 ID 标识开始菜单快捷方式，Electron 默认拼出的 ID 与它不同。
  if (ports.platform === "win32" && app.isPackaged) app.setAppUserModelId(appId)
  const names = new ProjectNameStore({ filePath: join(ports.userDataPath, "project-names.json") })
  const live = new Set<Notification>()
  const close = (native: Notification): void => {
    live.delete(native)
    try {
      native.close()
    } catch {
      // 个别原生通知关闭失败时继续退出。
    }
  }
  const controller = createBackgroundNotifications({
    ...ports,
    show(content, { click, failed }) {
      if (!Notification.isSupported()) return failed()
      const native = new Notification(content)
      live.add(native)
      native.once("click", () => {
        if (live.delete(native)) click()
      })
      native.once("failed", () => {
        if (live.delete(native)) failed()
      })
      native.on("close", (event) => {
        // Windows 的横幅超时后仍可从通知中心点击。
        if (event.reason !== "timedOut") live.delete(native)
      })
      try {
        native.show()
      } catch {
        if (live.delete(native)) failed()
      }
      if (live.size > retainedNotificationLimit) {
        const oldest = live.values().next().value
        if (oldest) close(oldest)
      }
    },
  })
  return {
    ...controller,
    /** 只从内存索引和本地配置读取通知标签，不读取会话时间线或 Claude 记录。 */
    session(envelope: SessionEnvelope, store: Promise<Pick<SessionStore, "get"> | null>): void {
      void controller
        .session(envelope, async (id): Promise<NotificationSession | null> => {
          const index = (await store)?.get(id)
          if (!index) return null
          const { projectPath, title, titleSource } = index
          const projectName = (await names.names([projectPath]))[projectPath]
          return { projectPath, title, titleSource, ...(projectName ? { projectName } : {}) }
        })
        .catch(() => undefined)
    },
    /** 停止投递并清理未处理的原生通知。 */
    dispose(): void {
      controller.dispose()
      for (const native of live) close(native)
    },
  }
}
