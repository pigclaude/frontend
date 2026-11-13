// 提供底部终端抽屉，收起时保留本项目的 PTY 与输出。
import { useState } from "react"
import { Plus, SquareTerminal, X } from "lucide-react"
import { Button, useLocale } from "@pigclaude/ui-primitives"
import type { WorkbenchBridge } from "../../../workbench-contract"
import { TerminalPane } from "./terminal-pane"

type Terminal = { id: string; number: number }

/** 维护当前工作区独立的多标签终端，与右栏的终端共用同一套宿主能力。 */
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
  const [terminals, setTerminals] = useState<Terminal[]>(() => [
    { id: crypto.randomUUID(), number: 1 },
  ])
  const [selected, setSelected] = useState<string | null>(null)
  const active = terminals.find((entry) => entry.id === selected) ?? terminals[0]

  function add(): void {
    const id = crypto.randomUUID()
    setTerminals((items) => [...items, { id, number: (items.at(-1)?.number ?? 0) + 1 }])
    setSelected(id)
  }

  function close(id: string): void {
    setTerminals((items) => items.filter((entry) => entry.id !== id))
  }

  return (
    <section
      className="terminal-drawer pigclaude-terminal-drawer"
      aria-label={t("panel.terminalDrawer")}
      hidden={!open}
    >
      <header className="terminal-drawer-head">
        <SquareTerminal className="ic ic-sm" aria-hidden="true" />
        <span className="terminal-drawer-title">{t("workbench.terminal")}</span>
        <div className="terminal-tabs grow" role="tablist" aria-label={t("panel.terminalTabs")}>
          {terminals.map((item) => (
            <button
              key={item.id}
              type="button"
              className="terminal-tab"
              role="tab"
              aria-selected={item === active}
              onClick={() => setSelected(item.id)}
            >
              {t("workbench.terminal")} {item.number}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="plain"
          size="icon"
          aria-label={t("terminal.new")}
          onClick={add}
        >
          <Plus className="ic ic-sm" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="plain"
          size="icon"
          aria-label={t("panel.closeTerminalDrawer")}
          onClick={onClose}
        >
          <X className="ic ic-sm" aria-hidden="true" />
        </Button>
      </header>
      {terminals.map((item) => (
        <div className="surface-pane" key={item.id} hidden={item !== active}>
          <TerminalPane
            bridge={bridge}
            root={root}
            id={item.id}
            active={open && item === active}
            onNew={add}
            onClose={() => close(item.id)}
          />
        </div>
      ))}
    </section>
  )
}
