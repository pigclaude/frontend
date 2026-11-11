// 负责持有外观设置：读写本机存储，推导并写到根元素，并跟随系统深色与减少动态偏好。
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { renderDockIcon } from "../lib/dock-icon-image"
import { applyAppearance } from "../lib/apply-appearance"
import { loadAppearance, saveAppearance, saveCustomThemes } from "../lib/appearance-storage"
import type { AppearanceSettings } from "../models/appearance-settings"
import type { AppearanceOutput } from "../models/appearance-tokens"
import { deriveAppearance } from "../models/appearance-tokens"
import { parseDevView } from "../models/dev-view"
import { resolveTheme } from "../models/theme-model"
import type { ThemeDefinition } from "../models/theme-presets"
import { parseCssColor } from "@pigclaude/pigcode-ui-primitives/theme-tokens"

const darkQuery = "(prefers-color-scheme: dark)"
const motionQuery = "(prefers-reduced-motion: reduce)"

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    list.addEventListener("change", onChange)
    return () => list.removeEventListener("change", onChange)
  }, [query])
  return matches
}

/**
 * 外观设置的唯一入口。保证：初次渲染读本机存储（含旧键迁移）；每次设置变化都会保存、
 * 重新推导并写到 `<html>`，同时同步 data-theme 和主进程窗口主题；开发期 ?theme= 优先。
 */
export function useAppearance() {
  const [initial] = useState(() => loadAppearance(window.localStorage))
  const [devView] = useState(() => parseDevView(window.location.search, import.meta.env.DEV))
  const [settings, setSettings] = useState<AppearanceSettings>(initial.settings)
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>(initial.customThemes)
  const systemDark = useMediaQuery(darkQuery)
  const prefersReducedMotion = useMediaQuery(motionQuery)
  const resolved = devView?.theme ?? resolveTheme(settings.mode, systemDark)
  const previous = useRef<AppearanceOutput | null>(null)

  const output = useMemo(
    () =>
      deriveAppearance(settings, customThemes, {
        resolved,
        glass: document.documentElement.dataset.glass === "true",
        platform: window.pigclaude?.platform ?? "",
        prefersReducedMotion,
      }),
    [settings, customThemes, resolved, prefersReducedMotion],
  )

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  useEffect(() => {
    applyAppearance(document.documentElement, output, previous.current)
    previous.current = output
  }, [output])

  useEffect(() => {
    saveAppearance(window.localStorage, settings)
  }, [settings])

  useEffect(() => {
    saveCustomThemes(window.localStorage, customThemes)
  }, [customThemes])

  useEffect(() => {
    void window.pigclaude?.setTheme?.(settings.mode)
  }, [settings.mode])

  // 让 Windows/Linux 原生标题栏和页面 token 同步；窗口材质只在能力存在且用户打开透明度时启用。
  const titleBarReported = useRef("")
  useEffect(() => {
    const native = window.pigcodeNative
    if (!native?.setTitleBarColors) return
    const rootStyle = getComputedStyle(document.documentElement)
    const color =
      parseCssColor(output.vars["--window"] ?? "") ??
      parseCssColor(rootStyle.getPropertyValue("--window")) ??
      parseCssColor(rootStyle.getPropertyValue("--bg"))
    const symbolColor =
      parseCssColor(output.vars["--fg-2"] ?? "") ??
      parseCssColor(rootStyle.getPropertyValue("--fg-2"))
    if (!color || !symbolColor) return
    const key = `${color}${symbolColor}`
    if (key === titleBarReported.current) return
    titleBarReported.current = key
    void native.setTitleBarColors({ color, symbolColor })
  }, [output])

  useEffect(() => {
    const translucent = document.documentElement.dataset.glass === "true" && settings.glass > 0
    void window.pigcodeNative?.setWindowTranslucent?.(translucent)
  }, [settings.glass])

  const dockApplied = useRef(false)
  useEffect(() => {
    if (settings.dockIcon === "classic" && !dockApplied.current) return
    let cancelled = false
    void renderDockIcon(settings.dockIcon)
      .then((dataUrl) => {
        if (cancelled) return
        dockApplied.current = settings.dockIcon !== "classic"
        return window.pigclaude?.setDockIcon?.(dataUrl)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [settings.dockIcon])

  const saveCustomTheme = useCallback((theme: ThemeDefinition) => {
    setCustomThemes((current) =>
      current.some((item) => item.id === theme.id)
        ? current.map((item) => (item.id === theme.id ? theme : item))
        : [...current, theme],
    )
  }, [])
  const removeCustomTheme = useCallback((id: string) => {
    setCustomThemes((current) => current.filter((item) => item.id !== id))
  }, [])
  const renameCustomTheme = useCallback((id: string, name: string) => {
    setCustomThemes((current) => current.map((item) => (item.id === id ? { ...item, name } : item)))
  }, [])

  return {
    settings,
    customThemes,
    resolved,
    update: setSettings,
    saveCustomTheme,
    removeCustomTheme,
    renameCustomTheme,
  }
}

/** useAppearance 返回的控制器，供外观页和 Composer 调用方使用。 */
export type AppearanceController = ReturnType<typeof useAppearance>
