// 负责把工作台的未保存文件告诉主进程：报告数量，有未保存的文件时拦下页面卸载，
// 按主进程的请求全部保存或全部放弃并回答。退出、关窗和刷新前的确认由主进程负责。
import { useEffect, useRef } from "react"
import type { WorkbenchBridge } from "../../../workbench-contract"
import type { FileDraft } from "./use-file-document"

/** 未保存文件的依赖：当前草稿、清掉草稿的方法，以及保存后的刷新和失败提示。 */
export type UnsavedFilesOptions = {
  bridge: WorkbenchBridge | undefined
  root: string | null
  drafts: ReadonlyMap<string, FileDraft>
  setDraft: (path: string, draft: FileDraft | null) => void
  clearDrafts: () => void
  onSaved: () => void
  /** 有文件没保存成功；草稿保留，参数是这些文件的路径。 */
  onSaveFailed: (paths: string[]) => void
}

/** 只要还有草稿，页面卸载（关窗、退出、刷新）就会被拦下，交给主进程询问。 */
export function useUnsavedFiles(options: UnsavedFilesOptions): void {
  const latest = useRef(options)
  latest.current = options
  const { bridge, root, drafts } = options

  useEffect(() => {
    void bridge?.reportUnsaved(drafts.size).catch(() => undefined)
  }, [bridge, drafts.size])

  useEffect(
    () => () => {
      void bridge?.reportUnsaved(0).catch(() => undefined)
    },
    [bridge],
  )

  useEffect(() => {
    const block = (event: BeforeUnloadEvent) => {
      if (latest.current.drafts.size === 0) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", block)
    return () => window.removeEventListener("beforeunload", block)
  }, [])

  useEffect(
    () =>
      bridge?.subscribe((event) => {
        if (event.type !== "unsaved-files") return
        const answer = (done: boolean) =>
          void bridge.unsavedDone(event.id, done).catch(() => undefined)
        if (event.action === "discard") {
          // 主进程收到回答就会关窗，页面可能在重新渲染前开始卸载。
          latest.current.drafts = new Map()
          latest.current.clearDrafts()
          answer(true)
          return
        }
        void saveAll(bridge, root, latest.current).then(answer)
      }),
    [bridge, root],
  )
}

async function saveAll(
  bridge: WorkbenchBridge,
  root: string | null,
  options: UnsavedFilesOptions,
): Promise<boolean> {
  if (!root) return options.drafts.size === 0
  const failed: string[] = []
  for (const [path, draft] of options.drafts) {
    try {
      await bridge.save(root, path, draft.text, draft.base.mtimeMs)
      options.setDraft(path, null)
    } catch {
      failed.push(path)
    }
  }
  options.onSaved()
  if (failed.length > 0) options.onSaveFailed(failed)
  return failed.length === 0
}
