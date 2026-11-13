// 提供底部终端抽屉，收起时保留本项目的 PTY 与输出。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { Plus, SquareTerminal, X } from "lucide-react"
import { Button, useLocale } from "@pigclaude/ui-primitives"
import type { WorkbenchBridge, WorkbenchTerminalInfo } from "../../../workbench-contract"
import { projectNameFromPath } from "../models/project-model"
import { TerminalDrawerResizer } from "./terminal-drawer-resizer"
import { TerminalPane } from "./terminal-pane"

type Terminal = { id: string; info?: WorkbenchTerminalInfo }
type Tabs = { items: Terminal[]; activeId: string; focus: "shell" | "tab" }

function initialTabs(): Tabs {
  const id = crypto.randomUUID()
  return { items: [{ id }], activeId: id, focus: "shell" }
}

/** 管理项目的多标签终端；关闭最后一个标签时收起，重新打开时启动新的 shell。 */
export function TerminalDrawer({
  bridge,
  root,
  open,
  onClose,
}: {
  bridge: WorkbenchBridge
  root: string
  open: boolean
  onClose: () => void
}) {
  const { t } = useLocale()
  const [height, setHeight] = useState(260)
  const [tabs, setTabs] = useState(initialTabs)
  const list = useRef<HTMLDivElement>(null)
  const closeDrawer = useRef(onClose)
  closeDrawer.current = onClose
  const active = tabs.items.find((item) => item.id === tabs.activeId)
  const name = projectNameFromPath(root) || t("workbench.terminal")

  useLayoutEffect(() => {
    if (tabs.items.length === 0) closeDrawer.current()
  }, [tabs.items.length])

  useEffect(() => {
    if (!open) return
    const button = list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    if (!button) return
    button.scrollIntoView({ block: "nearest", inline: "nearest" })
    if (tabs.focus === "tab") button.focus()
  }, [open, tabs.activeId, tabs.focus])

  // 收起后保留已启动的标签；最后一个已关时，等用户重新打开再创建。
  useLayoutEffect(() => {
    if (open && tabs.items.length === 0) setTabs(initialTabs())
  }, [open])

  function add(): void {
    const id = crypto.randomUUID()
    setTabs((current) => ({ items: [...current.items, { id }], activeId: id, focus: "shell" }))
  }

  function close(id: string): void {
    setTabs((current) => {
      const at = current.items.findIndex((item) => item.id === id)
      if (at < 0) return current
      const items = current.items.filter((item) => item.id !== id)
      const next = items[at] ?? items[at - 1]
      const activeId = id === current.activeId ? (next?.id ?? "") : current.activeId
      return { items, activeId, focus: current.focus }
    })
  }

  function select(id: string, focus: Tabs["focus"]): void {
    setTabs((current) => ({ ...current, activeId: id, focus }))
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, at: number, id: string): void {
    const last = tabs.items.length - 1
    const targets: Record<string, number> = {
      ArrowLeft: at > 0 ? at - 1 : last,
      ArrowRight: at < last ? at + 1 : 0,
      Home: 0,
      End: last,
    }
    if (event.key === "Delete") {
      event.preventDefault()
      close(id)
      return
    }
    const target = tabs.items[targets[event.key] ?? -1]
    if (!target) return
    event.preventDefault()
    select(target.id, "tab")
  }

  const titles = new Map<string, number>()
  return (
    <section
      className="terminal-drawer"
      aria-label={t("panel.terminalDrawer")}
      hidden={!open}
      style={{ height }}
    >
      <TerminalDrawerResizer height={height} onChange={setHeight} open={open} />
      <header className="terminal-drawer-head">
        <SquareTerminal className="ic ic-sm" aria-hidden="true" />
        <span className="terminal-drawer-title">{t("workbench.terminal")}</span>
        {active?.info?.shell ? (
          <span className="terminal-drawer-shell">{active.info.shell}</span>
        ) : null}
        <div
          className="terminal-tabs"
          role="tablist"
          aria-label={t("panel.terminalTabs")}
          ref={list}
        >
          {tabs.items.map((item, at) => {
            const base = projectNameFromPath(item.info?.cwd ?? root) || name
            const count = (titles.get(base) ?? 0) + 1
            titles.set(base, count)
            const title = count > 1 ? `${base} (${count})` : base
            const selected = item.id === tabs.activeId
            const closeLabel = t("panel.closeTerminal").replace("{title}", title)
            return (
              <div
                key={item.id}
                className="terminal-tab"
                data-active={selected || undefined}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault()
                    close(item.id)
                  }
                }}
              >
                <button
                  type="button"
                  role="tab"
                  className="terminal-tab-label"
                  id={`terminal-tab-${item.id}`}
                  aria-label={title}
                  aria-selected={selected}
                  aria-controls={`terminal-pane-${item.id}`}
                  tabIndex={selected ? 0 : -1}
                  title={item.info?.cwd ?? root}
                  onClick={() => select(item.id, "shell")}
                  onKeyDown={(event) => onTabKeyDown(event, at, item.id)}
                >
                  <span className="truncate">{base}</span>
                  {count > 1 ? <span className="terminal-tab-suffix"> ({count})</span> : null}
                </button>
                <button
                  type="button"
                  className="terminal-tab-close"
                  aria-label={closeLabel}
                  title={closeLabel}
                  onClick={() => close(item.id)}
                >
                  <X className="ic ic-xs" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
        <span className="grow" />
        <Button
          type="button"
          variant="plain"
          size="icon"
          aria-label={t("terminal.new")}
          title={t("terminal.new")}
          onClick={add}
        >
          <Plus className="ic ic-sm" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="plain"
          size="icon"
          aria-label={t("panel.closeTerminalDrawer")}
          title={t("panel.closeTerminalDrawer")}
          onClick={onClose}
        >
          <X className="ic ic-sm" aria-hidden="true" />
        </Button>
      </header>
      {tabs.items.map((item) => {
        const selected = item.id === tabs.activeId
        return (
          <div
            className="terminal-pane"
            key={item.id}
            id={`terminal-pane-${item.id}`}
            role="tabpanel"
            aria-labelledby={`terminal-tab-${item.id}`}
            hidden={!selected}
          >
            <TerminalPane
              bridge={bridge}
              root={root}
              id={item.id}
              active={open && selected}
              focusOnActivate={tabs.focus === "shell"}
              onOpened={(info) =>
                setTabs((current) => ({
                  ...current,
                  items: current.items.map((tab) => (tab.id === item.id ? { ...tab, info } : tab)),
                }))
              }
              onExit={() => close(item.id)}
            />
          </div>
        )
      })}
    </section>
  )
}
