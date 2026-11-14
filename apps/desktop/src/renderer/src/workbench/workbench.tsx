// 管理工作台的标签与项目绑定，将 Pigcode 的内置面板接到本机工作区。
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react"
import { FileDiff, Files, GitPullRequest, Globe, History, SquareTerminal } from "lucide-react"
import { useExtensionRegistry, type SurfaceContribution } from "@pigclaude/client-runtime"
import { EmptyState, useLocale } from "@pigclaude/ui-primitives"
import {
  EMPTY_SURFACE_STATE,
  FILE_SURFACE_KIND,
  PanelLayoutControls,
  RightPanel,
  addSurface,
  closeSurface,
  openFileSurface,
  updateSurface,
} from "@pigclaude/ui-workbench"
import type { WorkbenchBridge } from "../../../workbench-contract"
import { fill, useText } from "../locale/text"
import { BrowserPane } from "./browser-pane"
import { showFileTabMenu } from "./file-menus"
import { keepSurface, markUnsaved, openNavigationFile } from "./file-tabs"
import { FilesSurface } from "./files-surface"
import { CheckpointsPane, DiffPane, PullRequestPane, Worktrees } from "./git-panes"
import { TerminalPane } from "./terminal-pane"
import type { FileDraft } from "./use-file-document"
import { workbenchRelativePath } from "./workbench-path"

const owner = { kind: "builtin", id: "workbench" } as const
const surfaces = [
  ["browser", "workbench.browser", Globe, "B", true],
  ["terminal", "workbench.terminal", SquareTerminal, "T", true],
  ["files", "workbench.files", Files, "F", false],
  ["diff", "workbench.diff", FileDiff, "D", false],
  ["pr", "workbench.pr", GitPullRequest, "P", false],
  ["checkpoint", "workbench.checkpoint", History, "C", false],
] as const

/** 工作台与会话的联动，工具卡片可以打开指定文件或查看它的 Diff。 */
export type WorkbenchActions = {
  openFile: (path: string) => void
  openDiff: (path?: string) => void
  confirmSwitch: () => boolean
}

/** 工作台绑定会话的实际目录，尚未开始会话时使用当前项目。 */
export type WorkbenchProps = {
  bridge?: WorkbenchBridge | undefined
  root: string | null
  sessionId: string | null
  sessionActive: boolean
  turnActive: boolean
  turnRevision: number
  visible: boolean
  open: boolean
  maximized: boolean
  onToggle: () => void
  onShow: () => void
  onMaximize: () => void
  onSelectWorkspace: (path: string) => Promise<void>
  /** 侧栏「查看文件」的请求；root 与当前项目相同时打开文件标签，同一个 id 只处理一次。 */
  filesRequest?: { root: string; id: number } | null
}

/** 工作区与聊天共用右栏；子组件在切换普通标签时保留运行状态，文件标签共用一个文件面板。 */
export const Workbench = forwardRef<WorkbenchActions, WorkbenchProps>(
  function Workbench(props, ref) {
    const { t } = useLocale()
    const { t: text } = useText()
    const registry = useExtensionRegistry()
    const [state, setState] = useState(EMPTY_SURFACE_STATE)
    const [drafts, setDrafts] = useState<ReadonlyMap<string, FileDraft>>(() => new Map())
    const [revision, setRevision] = useState(0)
    const { bridge, root } = props
    const hasDraft = (path: string) => drafts.has(path)

    useEffect(() => {
      if (!registry) return
      const unregister = surfaces.map(([id, key, icon, shortcut, multiInstance], index) =>
        registry.register("surface", {
          id,
          owner,
          order: index * 10,
          title: { key },
          icon,
          shortcut,
          multiInstance,
          render: () => null,
        } satisfies SurfaceContribution),
      )
      return () => unregister.forEach((remove) => remove())
    }, [registry])

    useEffect(() => {
      setState(EMPTY_SURFACE_STATE)
      setDrafts(new Map())
    }, [root])

    useEffect(
      () =>
        bridge?.subscribe((event) => {
          if (event.type === "checkpoints-changed" && event.id === root) {
            setRevision((value) => value + 1)
          }
          if (event.type === "browser-open") {
            setState((current) => {
              if (current.surfaces.some((tab) => tab.id === event.id)) {
                return { ...current, activeId: event.id }
              }
              const added = addSurface(
                current,
                "browser",
                event.id,
                (index) =>
                  index > 1 ? `${t("workbench.browser")} ${index}` : t("workbench.browser"),
                { multiInstance: true },
              )
              return updateSurface(added, event.id, { url: event.url })
            })
            props.onShow()
          }
        }),
      [bridge, root, props.onShow, t],
    )

    const handledFiles = useRef<number | null>(null)
    const filesRequest = props.filesRequest ?? null
    useEffect(() => {
      if (!filesRequest || filesRequest.root !== root || handledFiles.current === filesRequest.id)
        return
      handledFiles.current = filesRequest.id
      setState((current) =>
        addSurface(current, "files", crypto.randomUUID(), () => t("workbench.files")),
      )
    }, [filesRequest, root, t])

    function add(kind: string): void {
      const surface = surfaces.find(([id]) => id === kind)
      if (!surface || !bridge || (!root && kind !== "browser")) return
      const [, key, , , multiple] = surface
      const id = crypto.randomUUID()
      setState((current) =>
        addSurface(
          current,
          kind,
          id,
          (index) => {
            const name = t(key)
            return kind === "terminal" || (multiple && index > 1) ? `${name} ${index}` : name
          },
          { multiInstance: multiple },
        ),
      )
    }

    function setDraft(path: string, draft: FileDraft | null): void {
      setDrafts((current) => {
        if (draft === null && !current.has(path)) return current
        const next = new Map(current)
        if (draft === null) next.delete(path)
        else next.set(path, draft)
        return next
      })
    }

    /** 关闭一组标签；其中有未保存的文件时先问一次，取消就什么都不关。 */
    function close(ids: readonly string[]): void {
      const unsaved = state.surfaces.filter(
        (tab) =>
          ids.includes(tab.id) &&
          tab.kind === FILE_SURFACE_KIND &&
          tab.path &&
          drafts.has(tab.path),
      )
      const question =
        unsaved.length > 1
          ? fill(text("workbench.discardDrafts"), {
              files: unsaved.map((tab) => tab.title).join("、"),
            })
          : text("workbench.discardDraft")
      if (unsaved.length > 0 && !window.confirm(question)) return
      for (const tab of unsaved) if (tab.path) setDraft(tab.path, null)
      setState((current) => ids.reduce((next, id) => closeSurface(next, id), current))
    }

    async function showTabMenu(id: string, point: { x: number; y: number }): Promise<void> {
      const ids = state.surfaces.map((tab) => tab.id)
      const choice = await showFileTabMenu(point, ids.length, t)
      if (choice === "close") close([id])
      else if (choice === "close-others") close(ids.filter((other) => other !== id))
      else if (choice === "close-all") close(ids)
    }

    function keep(id: string): void {
      setState((current) => keepSurface(current, id))
    }

    function keepDoubleClickedTab(event: MouseEvent<HTMLElement>): void {
      const tab = (event.target as Element).closest(".surface-tab[data-preview]")
      const id = tab?.querySelector('[role="tab"]')?.id.replace(/^surface-tab-/, "")
      if (id) keep(id)
    }

    function openFile(path: string): void {
      if (!root) return
      const relative = workbenchRelativePath(root, path)
      if (!relative) return
      const id = crypto.randomUUID()
      setState((current) => openFileSurface(current, relative, id))
    }

    function openFromNavigation(path: string, preview: boolean): void {
      const id = crypto.randomUUID()
      setState((current) => openNavigationFile(current, path, id, { preview, hasDraft }))
    }

    function confirmSwitch(): boolean {
      return drafts.size === 0 || window.confirm(text("workbench.discardProjectDrafts"))
    }

    useImperativeHandle(ref, () => ({
      openFile,
      confirmSwitch,
      openDiff(path) {
        if (!root) return
        const relative = path ? workbenchRelativePath(root, path) : ""
        if (relative === null) return
        setState((current) => {
          const next = addSurface(current, "diff", crypto.randomUUID(), () => t("workbench.diff"))
          return next.activeId ? updateSurface(next, next.activeId, { path: relative }) : next
        })
      },
    }))

    const refresh = () => setRevision((value) => value + 1)
    const controls = (
      <PanelLayoutControls
        rightOpen={props.open}
        onToggleRight={props.onToggle}
        maximized={props.maximized}
        onToggleMaximize={props.onMaximize}
      />
    )
    if (!bridge) return <EmptyState title={text("workbench.unavailable")} />

    const shared = root ? { bridge, root, revision: revision + props.turnRevision } : null
    const activeTab = state.surfaces.find((tab) => tab.id === state.activeId)
    const fileTab = activeTab?.kind === "files" || activeTab?.kind === FILE_SURFACE_KIND
    return (
      <div className="workbench" onDoubleClick={keepDoubleClickedTab}>
        <RightPanel
          threadId={props.sessionId}
          surfaces={markUnsaved(state.surfaces, hasDraft)}
          activeId={state.activeId}
          unavailable={(kind) => (kind !== "browser" && !root ? "project.add.pickerTitle" : null)}
          onAdd={add}
          onClose={(id) => close([id])}
          onFileTabMenu={(id, point) => void showTabMenu(id, point)}
          onActivate={(id) => setState((current) => ({ ...current, activeId: id }))}
          controls={controls}
        >
          {activeTab && fileTab && shared ? (
            <div key="file-navigation" className="surface-pane workbench-files">
              <FilesSurface
                {...shared}
                path={activeTab.path}
                line={activeTab.line}
                draft={activeTab.path ? (drafts.get(activeTab.path) ?? null) : null}
                onDraft={setDraft}
                onOpenFile={(path) => openFromNavigation(path, true)}
                onOpenFileTab={(path) => openFromNavigation(path, false)}
                onKeep={() => keep(activeTab.id)}
                onSaved={refresh}
                navigationFooter={
                  <Worktrees
                    {...shared}
                    current={shared.root}
                    onSelect={props.onSelectWorkspace}
                    onChanged={refresh}
                    confirmSwitch={confirmSwitch}
                    sessionActive={props.sessionActive}
                  />
                }
              />
            </div>
          ) : null}
          {state.surfaces.map((tab) => {
            const active = state.activeId === tab.id
            let content: ReactNode = null
            if (tab.kind === "browser") {
              content = (
                <BrowserPane
                  bridge={bridge}
                  id={tab.id}
                  initialUrl={tab.url}
                  active={active && props.visible}
                  onTitle={(title) =>
                    setState((current) => updateSurface(current, tab.id, { title }))
                  }
                />
              )
            } else if (shared) {
              if (tab.kind === "terminal")
                content = (
                  <TerminalPane
                    bridge={bridge}
                    root={shared.root}
                    id={tab.id}
                    active={active && props.visible}
                    onNew={() => add("terminal")}
                    onClose={() => close([tab.id])}
                  />
                )
              if (tab.kind === "diff" && active)
                content = <DiffPane {...shared} {...(tab.path ? { path: tab.path } : {})} />
              if (tab.kind === "pr" && active) content = <PullRequestPane {...shared} />
              if (tab.kind === "checkpoint" && active)
                content = (
                  <CheckpointsPane {...shared} onChanged={refresh} turnActive={props.turnActive} />
                )
            }
            if (!content) return null
            const scroll = ["diff", "pr", "checkpoint"].includes(tab.kind)
            return (
              <div
                key={tab.id}
                className={scroll ? "surface-pane surface-scroll" : "surface-pane"}
                hidden={!active}
              >
                {content}
              </div>
            )
          })}
        </RightPanel>
      </div>
    )
  },
)
