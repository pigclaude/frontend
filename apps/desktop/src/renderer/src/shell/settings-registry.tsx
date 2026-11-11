// 负责把 PigClaude 的设置页接到 Pigcode 扩展点：侧栏、命令面板和页面错误边界都从同一份注册表读取。
import { useEffect, useRef } from "react"
import {
  useExtensionRegistry,
  useContributions,
  type ContributionOwner,
  type ExtensionRegistry,
  type SettingsPageContribution,
} from "@pigclaude/pigcode-client-runtime"
import { EmptyState, useLocale } from "@pigclaude/pigcode-ui-primitives"
import { PageErrorBoundary } from "@pigclaude/pigcode-ui-shell"
import { Icon } from "@pigclaude/pigcode-ui-shell"
import type { ReactNode } from "react"
import { settingsNav, type SettingsPageId } from "../models/settings-nav"
import type { NavLocation } from "../models/navigation"

/** 设置页渲染函数；调用方用它把当前控制器状态闭包进页面。 */
export type SettingsPageRenderer = (page: SettingsPageId) => ReactNode

const owner: ContributionOwner = { kind: "builtin", id: "pigclaude-settings" }

/** 把一个 PigClaude 图标适配成 Pigcode 设置页扩展点需要的组件。 */
function settingsIcon(name: string) {
  return function SettingsIcon({
    className,
    "aria-hidden": ariaHidden,
  }: {
    className?: string
    "aria-hidden"?: "true"
  }) {
    return <Icon name={name} className={className} aria-hidden={ariaHidden} />
  }
}

/** 注册全部设置页和命令；返回清理函数，卸载外壳时不会留下旧页面。 */
export function registerSettingsPages(
  registry: ExtensionRegistry,
  render: SettingsPageRenderer,
  onSelect: (page: SettingsPageId) => void,
): () => void {
  const pages = settingsNav.flatMap((group) => group.items)
  const pageDisposers = pages.map((item, index) => {
    const contribution: SettingsPageContribution = {
      id: item.page,
      owner,
      order: index,
      title: { text: item.label },
      icon: settingsIcon(item.icon),
      render: () => render(item.page),
    }
    return registry.register("settingsPage", contribution)
  })
  const commandDisposers = pages.map((item, index) =>
    registry.register("command", {
      id: `settings-${item.page}`,
      owner,
      order: index,
      title: { text: item.label },
      keywords: [...item.keywords, "设置"],
      icon: item.icon,
      run: () => onSelect(item.page),
    }),
  )
  return () => {
    for (const dispose of [...pageDisposers, ...commandDisposers]) dispose()
  }
}

/** 在当前注册表上登记 PigClaude 的页面；渲染函数和导航回调始终取最新闭包。 */
export function SettingsRegistry({
  render,
  onSelect,
}: {
  render: SettingsPageRenderer
  onSelect: (page: SettingsPageId) => void
}) {
  const registry = useExtensionRegistry()
  const latest = useRef({ render, onSelect })
  latest.current = { render, onSelect }
  useEffect(() => {
    if (!registry) return undefined
    return registerSettingsPages(
      registry,
      (page) => latest.current.render(page),
      (page) => latest.current.onSelect(page),
    )
  }, [registry])
  return null
}

/** 画当前设置页；某一页抛错时只替换内容区，外壳和侧栏继续可用。 */
export function SettingsContributionView({ page }: { page: string }) {
  const { t } = useLocale()
  const current = useContributions("settingsPage").find((item) => item.id === page)
  if (!current) return <EmptyState title={t("settings.pageError")} />
  return (
    <PageErrorBoundary
      key={current.id}
      fallback={(reason) => <EmptyState title={t("settings.pageError")} description={reason} />}
    >
      {current.render()}
    </PageErrorBoundary>
  )
}

/** 设置导航位置转换：侧栏只处理 page 字符串，主导航仍保持 NavLocation 联合类型。 */
export function settingsLocation(page: string): NavLocation {
  return { kind: "settings", page }
}
