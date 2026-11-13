// 负责将应用设置页接入 Pigcode 的滚动容器、分组与设置行。
import type { ComponentProps, ReactNode } from "react"
import {
  SettingPage as PigcodeSettingPage,
  SettingRow as PigcodeSettingRow,
  SettingSection as PigcodeSettingSection,
} from "@pigclaude/ui-primitives"
import { ScrollPanel } from "@pigclaude/ui-shell"

/** 在 Pigcode 设置页外提供内容区的滚动与顶部拖动区。 */
export function SettingPage(props: ComponentProps<typeof PigcodeSettingPage>) {
  return (
    <ScrollPanel>
      <PigcodeSettingPage {...props} />
    </ScrollPanel>
  )
}

/** 把应用设置的分组标题与内容交给 Pigcode 设置分组。 */
export function SettingSection(props: ComponentProps<typeof PigcodeSettingSection>) {
  return <PigcodeSettingSection {...props} />
}

/** 使用 Pigcode 设置行，并为文件路径等数据保留等宽显示。 */
export function SettingRow({
  mono,
  description,
  ...props
}: ComponentProps<typeof PigcodeSettingRow> & {
  mono?: boolean
  description?: ReactNode
}) {
  return (
    <PigcodeSettingRow {...props} description={mono ? <code>{description}</code> : description} />
  )
}
