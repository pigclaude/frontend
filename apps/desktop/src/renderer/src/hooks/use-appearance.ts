// 负责在 Pigcode 外观控制器上接入 PigClaude 的旧设置和 macOS Dock 图标。
import { useEffect, useRef, useState } from "react"
import { useAppearance as usePigcodeAppearance } from "@pigclaude/ui-primitives"
import { migrateAppearanceStorage } from "../lib/appearance-migration"
import { renderDockIcon } from "../lib/dock-icon-image"

/** 首次读取外观时迁移旧设置，选择 Dock 图标时同步到 macOS。 */
export function useAppearance() {
  useState(() => migrateAppearanceStorage(window.localStorage))
  const appearance = usePigcodeAppearance()
  const dockApplied = useRef(false)
  const dockIcon = appearance.settings.dockIcon
  useEffect(() => {
    if (window.pigclaude?.platform !== "darwin") return
    if (dockIcon === "classic" && !dockApplied.current) return
    let cancelled = false
    void renderDockIcon(dockIcon)
      .then((dataUrl) => {
        if (cancelled) return
        dockApplied.current = dockIcon !== "classic"
        return window.pigclaude?.setDockIcon?.(dataUrl)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [dockIcon])
  return appearance
}

/** 外观页和会话共用的外观控制器。 */
export type AppearanceController = ReturnType<typeof useAppearance>
