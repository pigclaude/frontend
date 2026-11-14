// 负责页面里的新会话默认设置：启动后从主进程读一次，设置页修改后所有使用者一起更新。
// 预览环境没有桌面桥时只在内存里改，方便查看设置页。

import { useCallback, useEffect, useSyncExternalStore } from "react"
import {
  builtinSessionDefaults,
  type SessionDefaults,
  type SessionDefaultsPatch,
} from "../../../session-defaults-contract"

let current: SessionDefaults = builtinSessionDefaults
let loading: Promise<void> | null = null
// 每次保存加一；读取回来时已经保存过，就不用旧值覆盖。
let revision = 0
const listeners = new Set<() => void>()

function publish(next: SessionDefaults): void {
  current = next
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function load(): void {
  const read = window.pigclaude?.sessionDefaults?.get
  if (!read || loading) return
  const started = revision
  loading = read()
    .then((value) => {
      if (revision === started) publish(value)
    })
    .catch(() => {
      loading = null
    })
}

/** 新会话默认设置的读写。 */
export type SessionDefaultsController = {
  /** 当前设置；还没读到时是内置默认。 */
  defaults: SessionDefaults
  /** 保存修改；主进程拒绝时抛错，当前设置不变。 */
  save: (patch: SessionDefaultsPatch) => Promise<void>
}

/** 读取并修改新会话默认设置；同一窗口里的所有使用者看到同一份。 */
export function useSessionDefaults(): SessionDefaultsController {
  const defaults = useSyncExternalStore(subscribe, () => current)
  useEffect(load, [])
  const save = useCallback(async (patch: SessionDefaultsPatch) => {
    const write = window.pigclaude?.sessionDefaults?.set
    const next = write ? await write(patch) : { ...current, ...patch }
    revision += 1
    publish(next)
  }, [])
  return { defaults, save }
}

/** 测试之间清掉已读到的设置，下次挂载重新从桌面桥读。 */
export function resetSessionDefaultsForTest(): void {
  current = builtinSessionDefaults
  loading = null
  revision += 1
}
