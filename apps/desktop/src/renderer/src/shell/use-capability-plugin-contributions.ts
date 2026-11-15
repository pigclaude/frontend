// 使主窗口中的声明式命令和工具模板随插件启停、卸载与会员变化更新。
import { useEffect, useRef } from "react"
import { useExtensionRegistry } from "@pigclaude/client-runtime"
import { useToast } from "@pigclaude/ui-shell"
import { useText } from "../locale/text"
import { registerCapabilityPluginContributions } from "./capability-plugin-contributions"
import { insertPluginComposerText, pluginComposerTarget } from "./plugin-composer-insertion"

/** 从可信桥登记活动插件；用户触发的命令只能回到触发时的输入区。 */
export function useCapabilityPluginContributions(active: boolean, composerKey: string | null) {
  const registry = useExtensionRegistry()
  const bridge = window.pigclaude?.capabilityPlugins
  const toast = useToast()
  const { t } = useText()
  const latest = useRef({ composerKey, toast, t })
  latest.current = { composerKey, toast, t }

  useEffect(() => {
    if (!active || !registry || !bridge) return
    let disposed = false
    let generation = 0
    let remove: Array<() => void> = []
    function clear() {
      for (const dispose of remove) dispose()
      remove = []
    }
    function refresh() {
      if (!registry || !bridge) return
      const current = ++generation
      clear()
      void bridge.listDeclarations().then(
        (plugins) => {
          if (disposed || generation !== current) return
          remove = plugins.map((plugin) =>
            registerCapabilityPluginContributions(registry, plugin, async (id) => {
              const key = latest.current.composerKey
              const target = key === null ? null : pluginComposerTarget()
              try {
                const { insertText } = await bridge.runCommand(
                  { pluginId: plugin.pluginId, revision: plugin.revision },
                  id,
                )
                if (
                  !disposed &&
                  current === generation &&
                  key === latest.current.composerKey &&
                  target &&
                  insertText !== null
                )
                  insertPluginComposerText(target, insertText)
              } catch {
                if (!disposed && current === generation)
                  latest.current.toast(latest.current.t("capabilityPlugins.commandFailed"), "alert")
              }
            }),
          )
        },
        // 旧贡献已撤销，下一次安装或会员变化会重新读取。
        () => undefined,
      )
    }
    const unsubscribe = bridge.subscribe(refresh)
    refresh()
    return () => {
      disposed = true
      unsubscribe()
      clear()
    }
  }, [active, bridge, registry])
}
