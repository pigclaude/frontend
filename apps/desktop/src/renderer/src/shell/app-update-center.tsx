// 负责顶栏窗口按钮里的更新入口：只把 PigClaude 应用这一行交给拷入的更新中心，不传 Agent CLI 数据。
import { useState } from "react"
import { UpdateCenter } from "@pigclaude/ui-shell"
import { useAppUpdates } from "../hooks/use-app-updates"

const noCliUpdates = {}
const noAgentNames = {}

/** 顶栏的更新入口；没有新版本、也没有打开时不占位置。 */
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
        await updates.check()
      }}
      onUpdateApp={updates.perform}
      onUpdateCli={() => Promise.reject(new Error("CLI_UPDATES_UNSUPPORTED"))}
    />
  )
}
