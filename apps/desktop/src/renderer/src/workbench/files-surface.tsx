// 负责工作台的文件面板：内嵌目录导航和当前文件共用一个面板，窄面板时只显示导航；
// Markdown 可以预览，文件可以交给本机编辑器打开或另存为。
import { Suspense, lazy, useCallback, useState, type MouseEvent, type ReactNode } from "react"
import { useLocale } from "@pigclaude/ui-primitives"
import { OpenInButton, Resizer, useToast } from "@pigclaude/ui-shell"
import { FileExplorer, FileViewer } from "@pigclaude/ui-workbench"
import type { WorkbenchBridge } from "../../../workbench-contract"
import { useText } from "../locale/text"
import { projectNameFromPath } from "../models/project-model"
import { showFileMenu } from "./file-menus"
import { useFileDocument, type FileDraft } from "./use-file-document"
import { useFileNavigation } from "./use-file-navigation"
import { workbenchError } from "./workbench-errors"
import { absoluteFilePath } from "./workbench-path"

const Markdown = lazy(() =>
  import("@pigclaude/ui-chat").then((module) => ({ default: module.Markdown })),
)

/** 文件面板的属性；标签、草稿和固定预览由工作台管理。 */
export type FilesSurfaceProps = {
  bridge: WorkbenchBridge
  root: string
  revision: number
  /** 当前文件标签的文件；「文件」标签本身没有文件。 */
  path: string | undefined
  line: number | undefined
  draft: FileDraft | null
  onDraft: (path: string, draft: FileDraft | null) => void
  /** 单击：在预览标签里打开。 */
  onOpenFile: (path: string) => void
  /** ⌘ 或 Ctrl 单击：打开为固定的标签。 */
  onOpenFileTab: (path: string) => void
  /** 双击文件或开始编辑：当前预览标签固定下来。 */
  onKeep: () => void
  onSaved: () => void
  navigationFooter?: ReactNode
}

/** 渲染目录导航和当前文件；还没选文件时右侧显示空状态。 */
export function FilesSurface({
  bridge,
  root,
  revision,
  path,
  line,
  draft,
  onDraft,
  onOpenFile,
  onOpenFileTab,
  onKeep,
  onSaved,
  navigationFooter,
}: FilesSurfaceProps) {
  const { t } = useLocale()
  const { t: text } = useText()
  const toast = useToast()
  const aside = useFileNavigation(Boolean(path))
  const [focusDirectory, setFocusDirectory] = useState<{
    path: string | undefined
    directory: string
  } | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const [markdownMode, setMarkdownMode] = useState<{
    path: string
    mode: "preview" | "source"
  } | null>(null)
  const currentRevision = revision + refreshCount
  const fail = (failure: unknown) => toast(workbenchError(failure, text), "alert")
  const file = useFileDocument({
    bridge,
    root,
    path,
    revision: currentRevision,
    draft,
    onDraft,
    onSaved,
    onError: (message) => toast(message, "alert"),
  })
  const rootName = projectNameFromPath(root)
  const loadDirectory = useCallback((target: string) => bridge.list(root, target), [bridge, root])
  const searchPaths = useCallback((query: string) => bridge.search(root, query), [bridge, root])

  const directory = focusDirectory?.path === path ? focusDirectory?.directory : undefined
  const markdown =
    path !== undefined && /\.(md|markdown)$/i.test(path) && file.file !== null && !file.file.binary
  const preferredMode = markdownMode?.path === path ? markdownMode?.mode : undefined
  const open = (target: string, separate: boolean) => {
    setFocusDirectory(null)
    aside.selectFile()
    if (separate) onOpenFileTab(target)
    else onOpenFile(target)
  }
  const keepDoubleClicked = (event: MouseEvent<HTMLElement>) => {
    const row = (event.target as Element).closest('[role="treeitem"]')
    if (row && !row.hasAttribute("aria-expanded")) onKeep()
  }

  return (
    <div
      ref={aside.ref}
      className="files-surface"
      data-navigation-only={(aside.open && !aside.docked) || undefined}
    >
      <FileViewer
        {...file}
        onDraftChange={(value) => {
          if (value !== null && file.draft === null) onKeep()
          file.onDraftChange(value)
        }}
        path={path ?? null}
        rootName={rootName}
        revealLine={line ?? null}
        explorerOpen={aside.open}
        onToggleExplorer={() => aside.show(!aside.open)}
        onNavigate={(target) => {
          aside.show(true)
          setFocusDirectory({ path, directory: target })
        }}
        onMore={
          path
            ? (point) => void showFileMenu({ bridge, root, path, point, t }).catch(fail)
            : undefined
        }
        openIn={
          path ? (
            <OpenInButton
              path={absoluteFilePath(root, path)}
              openFile={(editor) => bridge.openFile(root, path, editor)}
            />
          ) : null
        }
        previewMode={preferredMode ?? (line || file.draft !== null ? "source" : "preview")}
        onPreviewModeChange={
          markdown && path ? (mode) => setMarkdownMode({ path, mode }) : undefined
        }
        preview={
          markdown ? (
            <article className="file-markdown-preview md">
              <Suspense fallback={null}>
                <Markdown text={file.draft ?? file.file?.text ?? ""} />
              </Suspense>
            </article>
          ) : undefined
        }
        navigationOnly={aside.open && !aside.docked}
        navigation={
          aside.open ? (
            <aside
              className="file-surface-aside"
              style={aside.docked ? { width: aside.width } : undefined}
              onDoubleClick={keepDoubleClicked}
            >
              <FileExplorer
                compact
                rootName={rootName}
                loadDirectory={loadDirectory}
                searchPaths={searchPaths}
                onOpenFile={(target) => open(target, false)}
                onOpenFileTab={(target) => open(target, true)}
                activePath={directory ?? path ?? null}
                activeKind={directory === undefined ? "file" : "directory"}
                revision={currentRevision}
                stateKey={`explorer:${root}`}
                onRefresh={() => setRefreshCount((count) => count + 1)}
              />
              {navigationFooter}
              {aside.docked ? (
                <Resizer
                  panel={aside.resizer}
                  edge="right"
                  className="panel-resizer file-navigation-resizer"
                  label={t("files.resizeNavigation")}
                  width={aside.width}
                  onChange={aside.resize}
                />
              ) : null}
            </aside>
          ) : null
        }
      />
    </div>
  )
}
