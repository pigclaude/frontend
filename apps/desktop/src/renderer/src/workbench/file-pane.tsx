// 接入 Pigcode 的目录树和文件编辑器，刷新保留草稿并提示磁盘冲突。
import { useCallback, useEffect, useRef, useState } from "react"
import { FileExplorer, FileViewer, type FileViewerFile } from "@pigclaude/ui-workbench"
import type { WorkbenchBridge } from "../../../workbench-contract"
import { useText } from "../locale/text"
import { projectNameFromPath } from "../models/project-model"
import { workbenchError } from "./workbench-errors"

type FilesProps = {
  bridge: WorkbenchBridge
  root: string
  revision: number
  onOpen: (path: string) => void
  activePath?: string | null
  compact?: boolean
}

/** 按项目保存展开状态，文件修改后刷新已展开的目录。 */
export function FilesPane({ bridge, root, revision, onOpen, activePath, compact }: FilesProps) {
  const loadDirectory = useCallback((path: string) => bridge.list(root, path), [bridge, root])
  const searchPaths = useCallback((query: string) => bridge.search(root, query), [bridge, root])
  return (
    <FileExplorer
      rootName={projectNameFromPath(root)}
      loadDirectory={loadDirectory}
      searchPaths={searchPaths}
      onOpenFile={onOpen}
      activePath={activePath}
      revision={revision}
      stateKey={root}
      {...(compact === undefined ? {} : { compact })}
    />
  )
}

type FileProps = FilesProps & {
  path: string
  line?: number | undefined
  onDirty: (dirty: boolean) => void
  onSaved: () => void
}

/** 文件标签可在保留草稿的情况下重新载入外部改动。 */
export function FilePane({
  bridge,
  root,
  path,
  line,
  revision,
  onOpen,
  onDirty,
  onSaved,
}: FileProps) {
  const { t } = useText()
  const [file, setFile] = useState<FileViewerFile | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [activePath, setActivePath] = useState(path)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let ignore = false
    void bridge
      .read(root, path)
      .then(
        (next) => {
          if (!ignore) setFile(next)
        },
        (failure: unknown) => {
          if (!ignore) setError(workbenchError(failure, t))
        },
      )
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [bridge, root, path, refresh, t])

  useEffect(() => {
    if (!file) return
    let ignore = false
    void bridge
      .read(root, path)
      .then((next) => {
        if (ignore || next.mtimeMs === file.mtimeMs) return
        if (draft !== null) setConflict(true)
        else setFile(next)
      })
      .catch(() => undefined)
    return () => {
      ignore = true
    }
  }, [bridge, root, path, revision, file, draft])

  function changeDraft(value: string | null): void {
    const next = value === file?.text ? null : value
    draftRef.current = next
    setDraft(next)
    onDirty(next !== null)
  }

  function reload(): void {
    changeDraft(null)
    setConflict(false)
    setError(null)
    setLoading(true)
    setRefresh((value) => value + 1)
  }

  async function save(overwrite: boolean): Promise<void> {
    if (!file || draft === null || saving) return
    setSaving(true)
    setError(null)
    try {
      const saved = await bridge.save(root, path, draft, overwrite ? null : file.mtimeMs)
      setFile(saved)
      if (draftRef.current === draft) changeDraft(null)
      setConflict(false)
      onSaved()
    } catch (failure: unknown) {
      if (failure instanceof Error && failure.message.includes("WORKBENCH_FILE_CHANGED"))
        setConflict(true)
      else setError(workbenchError(failure, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="workbench-file-content">
      {explorerOpen ? (
        <FilesPane
          bridge={bridge}
          root={root}
          revision={revision}
          onOpen={onOpen}
          activePath={activePath}
          compact
        />
      ) : null}
      <FileViewer
        path={path}
        rootName={projectNameFromPath(root)}
        file={file}
        draft={draft}
        loading={loading}
        saving={saving}
        conflict={conflict}
        error={error}
        explorerOpen={explorerOpen}
        onToggleExplorer={() => setExplorerOpen((open) => !open)}
        onNavigate={(directory) => {
          setExplorerOpen(true)
          setActivePath(directory)
        }}
        onDraftChange={changeDraft}
        onSave={() => void save(false)}
        onReload={reload}
        onOverwrite={() => void save(true)}
        revealLine={line}
      />
    </div>
  )
}
