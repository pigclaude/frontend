// 负责在页面里读取并订阅主进程的应用更新状态，顶栏更新中心和设置页共用。
import { useEffect, useState } from "react"
import type { DesktopUpdateState } from "@pigclaude/ui-contracts"
import type { UpdateResult } from "../../../main/updates/update-service"

/** 页面能用的更新能力。没有桌面桥时状态为 null，检查得到出错，其余动作什么都不做。 */
export type AppUpdates = {
  state: DesktopUpdateState | null
  checking: boolean
  check: () => Promise<UpdateResult>
  perform: () => Promise<void>
  setAutoCheck: (value: boolean) => Promise<void>
  /** 打开主进程当前持有的发布页或下载页。 */
  openReleasePage: () => Promise<void>
}

/** 读取主进程的更新状态并跟随推送；推送先到时不被较早发出的读取覆盖。 */
export function useAppUpdates(): AppUpdates {
  const bridge = window.pigclaude?.updates
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!bridge) return
    let active = true
    const unsubscribe = bridge.subscribe((next) => {
      if (active) setState(next)
    })
    void bridge.state().then((initial) => {
      if (active && initial) setState((current) => current ?? initial)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge])

  return {
    state,
    checking,
    async check() {
      if (!bridge) return { status: "error" }
      setChecking(true)
      try {
        return await bridge.check()
      } finally {
        setChecking(false)
      }
    },
    async perform() {
      const next = await bridge?.perform()
      if (next) setState(next)
    },
    async setAutoCheck(value) {
      const next = await bridge?.setAutoCheck(value)
      if (next) setState(next)
    },
    async openReleasePage() {
      await bridge?.openReleaseNotes()
    },
  }
}
