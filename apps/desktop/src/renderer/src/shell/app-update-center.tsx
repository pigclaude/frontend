// 负责顶栏窗口按钮里的更新入口：只把 PigClaude 应用这一行交给拷入的更新中心，不传 Agent CLI 数据。
import { useState } from "react"
import { UpdateCenter } from "@pigclaude/ui-shell"
import { useAppUpdates } from "../hooks/use-app-updates"
import { desktopText } from "../locale/text"

const noCliUpdates = {}
const noAgentNames = {}

/**
 * 顶栏的更新入口；没有新版本、也没有打开时不占位置。检查失败时，应用行在就由它显示失败，
 * 应用行不在就在弹层里报错，不显示「全部已是最新」。
 */
export function AppUpdateCenter() {
  const updates = useAppUpdates()
  const [open, setOpen] = useState(false)
  return (
    <UpdateCenter
      app={updates.state}
      cli={noCliUpdates}
      agentNames={noAgentNames}
      open={open}
      onOpenChange={setOpen}
      checking={updates.checking}
      onCheck={async () => {
        const hadAppRow = Boolean(updates.state?.version && updates.state.action)
        const result = await updates.check()
        if (result.status === "error" && !hadAppRow) {
          throw new Error(desktopText("appSettings.updateCheckFailed"))
        }
      }}
      onUpdateApp={updates.perform}
      onUpdateCli={() => Promise.reject(new Error("CLI_UPDATES_UNSUPPORTED"))}
    />
  )
}
