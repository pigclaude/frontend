// 负责将稳定的主题色外部快照接入 React，并提供固定的服务端默认值。
"use client"
import { useSyncExternalStore } from "react"
import {
  accentSnapshot,
  applyAccent,
  DEFAULT_ACCENT_CHOICE,
  subscribeAccent,
  type AccentChoice,
} from "./accent"

/** 多实例同步当前主题色，服务端始终从靛紫开始 hydration。 */
export function useAccent(): [AccentChoice, (choice: AccentChoice) => void] {
  const choice = useSyncExternalStore(subscribeAccent, accentSnapshot, () => DEFAULT_ACCENT_CHOICE)
  return [choice, applyAccent]
}
