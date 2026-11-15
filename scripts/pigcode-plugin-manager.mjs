// 为 Pigcode 的插件列表和详情生成类型标签、详情内容、启停可用性和卸载选项插槽。

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
  [
    "  plugins: PluginSummary[]\n",
    "  plugins: PluginSummary[]\n  /** 为宿主支持的插件分组提供显示名称。 */\n  kindLabels?: Partial<Record<PluginKind, string>> | undefined\n",
  ],
  ["  kind,\n  plugins,\n", "  heading,\n  plugins,\n"],
  ["{ kind: PluginKind; plugins:", "{ heading: string; plugins:"],
  ["        {t(kindKeys[kind])}\n", "        {heading}\n"],
  ['query = "", onInstall, ...actions', 'query = "", onInstall, kindLabels, ...actions'],
  ["            kind={kind}\n", "            heading={kindLabels?.[kind] ?? t(kindKeys[kind])}\n"],
]

const detailsSlots = [
  ['import { useState } from "react"', 'import { useState, type ReactNode } from "react"'],
  [
    "  confirmUninstall?: boolean | undefined\n",
    "  confirmUninstall?: boolean | undefined\n  /** 在确认卸载时显示宿主提供的选项。 */\n  uninstallOptions?: ReactNode\n  /** 当前类型的自定义显示名称。 */\n  kindLabel?: string | undefined\n  /** 宿主提供的详情行，替换默认的 API、权限与服务行。 */\n  runtimeFacts?: ReactNode\n",
  ],
  [
    "  confirmUninstall,\n",
    "  confirmUninstall,\n  uninstallOptions,\n  kindLabel,\n  runtimeFacts,\n",
  ],
  [
    "          <Badge>{t(kindKeys[plugin.kind])}</Badge>",
    "          <Badge>{kindLabel ?? t(kindKeys[plugin.kind])}</Badge>",
  ],
  [
    "          <dd>{t(kindKeys[plugin.kind])}</dd>",
    "          <dd>{kindLabel ?? t(kindKeys[plugin.kind])}</dd>",
  ],
  [
    '          <dt>{t("plugins.facts.api")}</dt>\n',
    '          {runtimeFacts ?? (\n            <>\n              <dt>{t("plugins.facts.api")}</dt>\n',
  ],
  [
    "          {plugin.originLabel ? (\n",
    "            </>\n          )}\n          {plugin.originLabel ? (\n",
  ],
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
