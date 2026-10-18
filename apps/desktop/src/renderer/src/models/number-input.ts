// 负责外观页数字输入框（字号）的取值规则：解析文字、夹到上下限、对齐到步长。

/** 数字输入框允许的范围和步长。 */
export type SteppedRange = { min: number; max: number; step: number }

function parse(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

const snap = (value: number, step: number): number => Math.round(value / step) * step

/** 失焦或回车时提交：非数字返回 null；否则夹到 [min, max] 并四舍五入到步长。 */
export function parseStepped(text: string, range: SteppedRange): number | null {
  const value = parse(text)
  if (value === null) return null
  const clamped = Math.min(range.max, Math.max(range.min, value))
  return Math.min(range.max, Math.max(range.min, snap(clamped, range.step)))
}

/** 输入过程中立即生效：只有已在范围内且正好落在步长上的值才返回，其余返回 null，避免打字途中跳值。 */
export function exactStepped(text: string, range: SteppedRange): number | null {
  const value = parse(text)
  if (value === null || value < range.min || value > range.max) return null
  return Math.abs(snap(value, range.step) - value) < 1e-9 ? value : null
}
