// 为 Pigcode 的插件列表和详情生成通用的启停可用性与卸载选项插槽。

const listSlots = [
  [
    "  pendingId: string | null\n",
    "  pendingId: string | null\n  /** 由宿主决定此项能否切换启用状态。 */\n  canToggle?: ((id: string) => boolean) | undefined\n",
  ],
  ["  pendingId,\n", "  pendingId,\n  canToggle,\n"],
  [
    "          disabled={pending}\n",
    "          disabled={pending || canToggle?.(plugin.id) === false}\n",
  ],
]

const detailsSlots = [
  ['import { useState } from "react"', 'import { useState, type ReactNode } from "react"'],
  [
    "  confirmUninstall?: boolean | undefined\n",
    "  confirmUninstall?: boolean | undefined\n  /** 在确认卸载时显示宿主提供的选项。 */\n  uninstallOptions?: ReactNode\n",
  ],
  ["  confirmUninstall,\n", "  confirmUninstall,\n  uninstallOptions,\n"],
  [
    "      </Dialog.Body>\n",
    "        {canUninstall && confirming ? uninstallOptions : null}\n      </Dialog.Body>\n",
  ],
  [
    '              <span className="plugin-dialog-hint">{t("plugins.uninstallHint")}</span>',
    '              {uninstallOptions == null ? <span className="plugin-dialog-hint">{t("plugins.uninstallHint")}</span> : null}',
  ],
]

/** 只接通展示插槽；上游锚点变动时停止同步，避免静默生成不完整的组件。 */
export function projectPluginManagerSlots(source, path) {
  const slots =
    path === "src/plugin-list.tsx"
      ? listSlots
      : path === "src/plugin-details.tsx"
        ? detailsSlots
        : []
  let output = source
  for (const [before, after] of slots) {
    const at = output.indexOf(before)
    if (at < 0 || output.indexOf(before, at + before.length) >= 0) {
      throw new Error(`Pigcode 插件插槽源位置已变动：${path}`)
    }
    output = output.replace(before, after)
  }
  return output
}
