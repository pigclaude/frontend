// 负责应用主题色、严格校验版本化缓存并通知已挂载的选择器。
import { accentEngine } from "./accent-engine"
import { ACCENT_PRESETS, type AccentPalette, type AccentPresetId } from "./accent-presets"

/** 只保存预设标识或六位 HEX，CSS 缓存必须与逻辑选择一致。 */
export type AccentChoice = { kind: "preset"; id: AccentPresetId } | { kind: "custom"; hex: string }
/** 主题色持久化键。 */
export const ACCENT_STORAGE_KEY = "pigclaude-accent"
/** 当前主题色缓存编码版本。 */
export const ACCENT_STORAGE_VERSION = 1
/** 服务端和无效缓存共享稳定默认快照。 */
export const DEFAULT_ACCENT_CHOICE: AccentChoice = { kind: "preset", id: "indigo" }
const listeners = new Set<() => void>()
let snapshot: AccentChoice = DEFAULT_ACCENT_CHOICE
let appliedWithoutStorage = false

/** 根据合法的逻辑选择返回完整深浅调色板。 */
export function paletteFor(choice: AccentChoice): AccentPalette {
  return accentEngine.paletteFor(choice, ACCENT_PRESETS)
}
/** 输出高特异度主题 token，并为按钮生成独立的 AA 安全交互填充。 */
export const accentCss = accentEngine.accentCss

function stabilize(choice: AccentChoice) {
  if (JSON.stringify(snapshot) !== JSON.stringify(choice)) snapshot = choice
  return snapshot
}

/** 存储缺失、拒绝、版本过期或缓存被篡改时返回默认预设。 */
export function readAccent(): AccentChoice {
  try {
    const cached = accentEngine.parse(localStorage.getItem(ACCENT_STORAGE_KEY), ACCENT_PRESETS)
    return stabilize(cached?.choice ?? DEFAULT_ACCENT_CHOICE)
  } catch {
    return DEFAULT_ACCENT_CHOICE
  }
}

/** 为外部状态订阅提供稳定引用，存储受限时保留当前页面的用户选择。 */
export function accentSnapshot(): AccentChoice {
  return appliedWithoutStorage ? snapshot : readAccent()
}

/** 订阅当前模块变更和其它页面的存储事件，移除时释放监听器。 */
export function subscribeAccent(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== ACCENT_STORAGE_KEY) return
    appliedWithoutStorage = false
    const choice = readAccent()
    let valid = false
    try {
      valid = accentEngine.parse(localStorage.getItem(ACCENT_STORAGE_KEY), ACCENT_PRESETS) !== null
    } catch {
      valid = false
    }
    if (valid) inject(accentCss(paletteFor(choice)))
    else document.getElementById(ACCENT_STORAGE_KEY)?.remove()
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

function inject(css: string) {
  let style = document.getElementById(ACCENT_STORAGE_KEY)
  if (!style) {
    style = document.createElement("style")
    style.id = ACCENT_STORAGE_KEY
    document.head.appendChild(style)
  }
  style.textContent = css
}

/** 在存储不可用时也立即更新页面，并通知所有选择器。 */
export function applyAccent(choice: AccentChoice): void {
  const css = accentCss(paletteFor(choice))
  const raw = JSON.stringify({ v: ACCENT_STORAGE_VERSION, choice, css })
  const parsed = accentEngine.parse(raw, ACCENT_PRESETS)
  if (!parsed) return
  inject(parsed.css)
  stabilize(parsed.choice)
  appliedWithoutStorage = false
  try {
    localStorage.setItem(
      ACCENT_STORAGE_KEY,
      JSON.stringify({ v: ACCENT_STORAGE_VERSION, ...parsed }),
    )
  } catch {
    appliedWithoutStorage = true
  }
  for (const listener of listeners) listener()
}

/** 移除缓存与覆盖样式，使默认靛紫立即生效。 */
export function resetAccent(): void {
  document.getElementById(ACCENT_STORAGE_KEY)?.remove()
  stabilize(DEFAULT_ACCENT_CHOICE)
  appliedWithoutStorage = false
  try {
    localStorage.removeItem(ACCENT_STORAGE_KEY)
  } catch {
    appliedWithoutStorage = true
  }
  for (const listener of listeners) listener()
}
