// 管理工作台的标签与项目绑定，将 Pigcode 的内置面板接到本机工作区。
import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from "react"
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
import { useText } from "../locale/text"
import { BrowserPane } from "./browser-pane"
import { FilePane, FilesPane } from "./file-pane"
import { CheckpointsPane, DiffPane, PullRequestPane, Worktrees } from "./git-panes"
import { TerminalPane } from "./terminal-pane"
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
}

/** 工作区与聊天共用右栏；子组件在切换普通标签时保留运行状态。 */
export const Workbench = forwardRef<WorkbenchActions, WorkbenchProps>(
  function Workbench(props, ref) {
    const { t } = useLocale()
    const { t: text } = useText()
    const registry = useExtensionRegistry()
    const [state, setState] = useState(EMPTY_SURFACE_STATE)
    const [revision, setRevision] = useState(0)
    const { bridge, root } = props

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

    function close(id: string): void {
      const tab = state.surfaces.find((item) => item.id === id)
      if (tab?.dirty && !window.confirm(text("workbench.discardDraft"))) return
      setState((current) => closeSurface(current, id))
    }

    function openFile(path: string): void {
      if (!root) return
      const relative = workbenchRelativePath(root, path)
      if (!relative) return
      const id = crypto.randomUUID()
      setState((current) => openFileSurface(current, relative, id))
    }
    function confirmSwitch(): boolean {
      return (
        !state.surfaces.some((tab) => tab.dirty) ||
        window.confirm(text("workbench.discardProjectDrafts"))
      )
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

    return (
      <div className="workbench">
        <RightPanel
          threadId={props.sessionId}
          surfaces={state.surfaces}
          activeId={state.activeId}
          unavailable={(kind) => (kind !== "browser" && !root ? "project.add.pickerTitle" : null)}
          onAdd={add}
          onClose={close}
          onActivate={(id) => setState((current) => ({ ...current, activeId: id }))}
          controls={controls}
        >
          {state.surfaces.map((tab) => {
            const active = state.activeId === tab.id
            const shared = root ? { bridge, root, revision: revision + props.turnRevision } : null
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
                    onClose={() => close(tab.id)}
                  />
                )
              if (tab.kind === "files" && active)
                content = (
                  <>
                    <Worktrees
                      {...shared}
                      current={shared.root}
                      onSelect={props.onSelectWorkspace}
                      onChanged={refresh}
                      confirmSwitch={confirmSwitch}
                      sessionActive={props.sessionActive}
                    />
                    <FilesPane {...shared} onOpen={openFile} />
                  </>
                )
              if (tab.kind === FILE_SURFACE_KIND && tab.path)
                content = (
                  <FilePane
                    {...shared}
                    path={tab.path}
                    line={tab.line}
                    onOpen={openFile}
                    onSaved={refresh}
                    onDirty={(dirty) =>
                      setState((current) => updateSurface(current, tab.id, { dirty }))
                    }
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
