// 通过已有的应用内短提示呈现能力插件名称与消息。

import { useEffect } from "react"
import { useToast } from "@pigclaude/ui-shell"
import { fill, useText } from "../locale/text"

/** 在整窗上下文内订阅插件消息，路由切换时保留同一个订阅。 */
export function CapabilityPluginNoticeListener(): null {
  const toast = useToast()
  const { t } = useText()
  useEffect(
    () =>
      window.pigclaude?.capabilityPluginNotices?.subscribe(({ pluginName, message }) => {
        toast(fill(t("shell.notice.capabilityPlugin"), { plugin: pluginName, message }), "cube")
      }),
    [toast, t],
  )
  return null
}
