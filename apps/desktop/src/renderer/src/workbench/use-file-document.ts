// 负责当前文件的读取与保存：草稿由工作台保管，切换标签后还在；
// 磁盘上的文件在编辑期间被改过时提示冲突，由用户选择重新加载或覆盖，不静默覆盖。
import { useEffect, useRef, useState } from "react"
import type { WorkbenchBridge, WorkbenchFile } from "../../../workbench-contract"
import { useText } from "../locale/text"
import { workbenchError } from "./workbench-errors"

/** 文件标签里还没保存的修改，以及开始编辑时读到的那一版文件。 */
export type FileDraft = { text: string; base: WorkbenchFile }

type Loaded = { path: string; file: WorkbenchFile | null; error: string | null; conflict: boolean }

/** 文件预览需要的读写状态；返回值的字段与 FileViewer 的属性同名。 */
export function useFileDocument({
  bridge,
  root,
  path,
  revision,
  draft,
  onDraft,
  onSaved,
  onError,
}: {
  bridge: WorkbenchBridge
  root: string
  path: string | undefined
  revision: number
  draft: FileDraft | null
  onDraft: (path: string, draft: FileDraft | null) => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const { t } = useText()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [savingPath, setSavingPath] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const pending = useRef(draft)
  pending.current = draft
  const current = loaded?.path === path ? loaded : null

  useEffect(() => {
    if (!path) return
    let ignore = false
    void bridge.read(root, path).then(
      (next) => {
        if (ignore) return
        const edited = pending.current
        setLoaded({
          path,
          file: edited ? edited.base : next,
          error: null,
          conflict: edited !== null && edited.base.mtimeMs !== next.mtimeMs,
        })
      },
      (failure: unknown) => {
        if (!ignore)
          setLoaded({ path, file: null, error: workbenchError(failure, t), conflict: false })
      },
    )
    return () => {
      ignore = true
    }
  }, [bridge, root, path, revision, reload, t])

  async function save(overwrite: boolean): Promise<void> {
    const edited = pending.current
    if (!path || !edited || savingPath !== null) return
    setSavingPath(path)
    try {
      const saved = await bridge.save(
        root,
        path,
        edited.text,
        overwrite ? null : edited.base.mtimeMs,
      )
      setLoaded({ path, file: saved, error: null, conflict: false })
      const latest = pending.current
      onDraft(
        path,
        latest && latest.text !== edited.text ? { text: latest.text, base: saved } : null,
      )
      onSaved()
    } catch (failure: unknown) {
      if (failure instanceof Error && failure.message.includes("WORKBENCH_FILE_CHANGED")) {
        setLoaded((value) => (value?.path === path ? { ...value, conflict: true } : value))
      } else onError(workbenchError(failure, t))
    } finally {
      setSavingPath(null)
    }
  }

  return {
    file: current?.file ?? null,
    loading: Boolean(path) && current === null,
    error: current?.error ?? null,
    draft: draft?.text ?? null,
    onDraftChange: (text: string | null) => {
      const file = current?.file
      if (!path || !file) return
      const base = pending.current?.base ?? file
      onDraft(path, text === null || text === base.text ? null : { text, base })
    },
    saving: path !== undefined && savingPath === path,
    conflict: current?.conflict ?? false,
    onSave: () => void save(false),
    onOverwrite: () => void save(true),
    onReload: () => {
      if (!path) return
      onDraft(path, null)
      setLoaded(null)
      setReload((value) => value + 1)
    },
  }
}
