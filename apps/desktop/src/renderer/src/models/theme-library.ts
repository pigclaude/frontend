// 负责新主题加入「我的主题」前的整理：名字限长去重、id 不与内置主题和已有主题冲突。
import type { ThemeDefinition } from "./theme-presets"
import { builtInThemes } from "./theme-presets"

/** 主题名最多 40 个字符（按字符计，不按 UTF-16 单元）。 */
export const maxThemeNameLength = 40

const fallbackName = "未命名主题"

const cut = (text: string, length: number): string => Array.from(text).slice(0, length).join("")

/** 去掉首尾空白、截到上限；与 existing 重复时加「 2」「 3」…，加序号后仍不超过上限。 */
export function uniqueThemeName(name: string, existing: readonly string[]): string {
  const base = cut(name.trim(), maxThemeNameLength).trim() || fallbackName
  if (!existing.includes(base)) return base
  for (let n = 2; ; n += 1) {
    const suffix = ` ${n}`
    const candidate = `${cut(base, maxThemeNameLength - suffix.length).trim()}${suffix}`
    if (!existing.includes(candidate)) return candidate
  }
}

/**
 * 整理一个将要保存的主题：builtIn 恒为 false；id 为 `custom-` 加 makeId 的结果，
 * 与内置主题和 custom 里的 id 都不同；名字与内置主题和 custom 的名字都不同。不修改输入。
 */
export function prepareCustomTheme(
  theme: ThemeDefinition,
  custom: readonly ThemeDefinition[],
  makeId: () => string,
): ThemeDefinition {
  const all = [...builtInThemes, ...custom]
  const ids = new Set(all.map((item) => item.id))
  let id = `custom-${makeId()}`
  while (ids.has(id)) id = `custom-${makeId()}`
  const name = uniqueThemeName(
    theme.name,
    all.map((item) => item.name),
  )
  return { ...theme, id, name, builtIn: false }
}
