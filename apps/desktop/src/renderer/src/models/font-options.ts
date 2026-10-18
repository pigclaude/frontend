// 负责外观页字体与字重下拉的选项表，以及按「本机是否已安装」过滤选项。
import type { AppearanceSettings, ThemeSlot } from "./appearance-settings"

/** 一个字体选项；family 为要检测的字体族名，null 表示总是可用（系统字体或通用族）。 */
export type FontOption<T extends string> = { value: T; label: string; family: string | null }

/** 界面字体：系统、Inter、思源黑体。 */
export const uiFontOptions: readonly FontOption<ThemeSlot["uiFont"]>[] = [
  { value: "system", label: "系统", family: null },
  { value: "inter", label: "Inter", family: "Inter" },
  { value: "source-han", label: "思源黑体", family: "Source Han Sans SC" },
]

/** 内容字体：与界面字体相同、衬线、圆体；后两者都有通用族兜底，不做检测。 */
export const contentFontOptions: readonly FontOption<AppearanceSettings["contentFont"]>[] = [
  { value: "same", label: "与界面字体相同", family: null },
  { value: "serif", label: "衬线", family: null },
  { value: "rounded", label: "圆体", family: null },
]

/** 代码字体：系统、JetBrains Mono、Fira Code、Menlo。 */
export const codeFontOptions: readonly FontOption<AppearanceSettings["codeFont"]>[] = [
  { value: "system", label: "系统", family: null },
  { value: "jetbrains", label: "JetBrains Mono", family: "JetBrains Mono" },
  { value: "fira", label: "Fira Code", family: "Fira Code" },
  { value: "menlo", label: "Menlo", family: "Menlo" },
]

/** 字重：常规、中等。 */
export const weightOptions: readonly FontOption<"regular" | "medium">[] = [
  { value: "regular", label: "常规", family: null },
  { value: "medium", label: "中等", family: null },
]

/**
 * 只留下本机已安装的选项。保证：不需要检测的选项总在；当前选中的选项即使检测不到也保留；
 * 顺序不变；每个字体族只交给 isInstalled 检测一次。
 */
export function installedFontOptions<T extends string>(
  options: readonly FontOption<T>[],
  current: T,
  isInstalled: (family: string) => boolean,
): FontOption<T>[] {
  return options.filter(
    (option) => option.family === null || option.value === current || isInstalled(option.family),
  )
}
