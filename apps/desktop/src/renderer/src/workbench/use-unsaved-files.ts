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
  // 回答主进程前先更新：主进程收到回答就可能关窗，页面来不及重新渲染。
  const blocking = useRef(options.drafts)
  blocking.current = options.drafts
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
      if (blocking.current.size === 0) return
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
        const answer = (remaining: ReadonlyMap<string, FileDraft>) => {
          blocking.current = remaining
          void bridge.unsavedDone(event.id, remaining.size === 0).catch(() => undefined)
        }
        if (event.action === "discard") {
          latest.current.clearDrafts()
          answer(new Map())
          return
        }
        void saveAll(bridge, root, latest.current).then(answer)
      }),
    [bridge, root],
  )
}

/** 逐个保存草稿，返回没保存成功的那些。 */
async function saveAll(
  bridge: WorkbenchBridge,
  root: string | null,
  options: UnsavedFilesOptions,
): Promise<ReadonlyMap<string, FileDraft>> {
  if (!root) return options.drafts
  const failed = new Map<string, FileDraft>()
  for (const [path, draft] of options.drafts) {
    try {
      await bridge.save(root, path, draft.text, draft.base.mtimeMs)
      options.setDraft(path, null)
    } catch {
      failed.set(path, draft)
    }
  }
  options.onSaved()
  if (failed.size > 0) options.onSaveFailed([...failed.keys()])
  return failed
}
