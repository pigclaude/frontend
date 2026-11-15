// 托盘与通知走主窗口已有的会话打开和草稿流程，沿用未保存文件检查。

import { useEffect, useRef } from "react"
import type { MembershipState } from "@pigclaude/contracts/membership"

/** 接收原生导航；新会话同时核对当前渲染层会员状态。 */
export function useWindowNavigation(actions: {
  membership: MembershipState
  openSession: (id: string) => void
  newSession: () => void
  openAccounts: () => void
}): void {
  const latest = useRef(actions)
  latest.current = actions
  useEffect(
    () =>
      window.pigclaude?.window?.onNavigation?.((command) => {
        const target = latest.current
        if (command.kind === "session") target.openSession(command.sessionId)
        else if (command.kind === "accounts") target.openAccounts()
        else if (target.membership === "active") target.newSession()
      }),
    [],
  )
}
