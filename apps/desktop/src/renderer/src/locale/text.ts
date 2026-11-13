// 负责读取 PigClaude 的文案：按 Pigcode LocaleProvider 给出的当前语言查词典，并填入 {name} 这类占位。
import { useMemo } from "react"
import { useLocale, type Locale } from "@pigclaude/ui-primitives"
import { enUS } from "./messages.en-US"
import { zhCN } from "./messages.zh-CN"

/** PigClaude 的全部文案键。 */
export type TextKey = keyof typeof zhCN

const dictionaries: Record<Locale, Record<TextKey, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
}

/** 不经过 React 读取一条文案。 */
export function text(locale: Locale, key: TextKey): string {
  return dictionaries[locale][key]
}

/** 把模板里的 {name} 换成对应的值；值里没有的占位原样保留。 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  )
}

/** 当前语言下的 t()；必须在 LocaleProvider 里调用。 */
export function useText(): { locale: Locale; t: (key: TextKey) => string } {
  const { locale } = useLocale()
  return useMemo(() => ({ locale, t: (key: TextKey) => text(locale, key) }), [locale])
}
