// 将真实 PTY 连接到 Pigcode 的 xterm 视图，切换标签或隐藏面板时保留会话。
import { Plus, Trash2 } from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Button, useLocale } from "@pigclaude/ui-primitives"
import type { TerminalHandle } from "@pigclaude/ui-workbench"
import type { WorkbenchBridge } from "../../../workbench-contract"
import { fill, useText } from "../locale/text"
import { workbenchError } from "./workbench-errors"

type Props = {
  bridge: WorkbenchBridge
  root: string
  id: string
  active: boolean
  onNew: () => void
  onClose: () => void
}

const TerminalView = lazy(async () => ({
  default: (await import("@pigclaude/ui-workbench/terminal-view")).TerminalView,
}))

/** 一个工作台终端；事件在打开 shell 前订阅，卸载时等待打开后再关闭。 */
export function TerminalPane({ bridge, root, id, active, onNew, onClose }: Props) {
  const { t } = useLocale()
  const { t: text } = useText()
  const handle = useRef<TerminalHandle | null>(null)
  const output = useRef("")
  const terminalOperation = useRef(Promise.resolve())
  const running = useRef(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const stop = bridge.subscribe((event) => {
      if (event.id !== id) return
      if (event.type === "terminal-data") {
        if (handle.current) handle.current.write(event.data)
        else output.current = (output.current + event.data).slice(-64 * 1024)
      }
      if (event.type === "terminal-exit") {
        running.current = false
        setExitCode(event.exitCode)
      }
    })
    const started = terminalOperation.current
      .then(() => {
        if (!cancelled) return bridge.terminalOpen(root, id)
      })
      .then(() => {
        if (!cancelled) {
          running.current = true
          handle.current?.fit()
        }
      })
    void started.catch((failure: unknown) => {
      if (!cancelled) setError(workbenchError(failure, text))
    })
    return () => {
      cancelled = true
      running.current = false
      stop()
      terminalOperation.current = started
        .then(() => bridge.terminalClose(id))
        .catch(() => undefined)
    }
  }, [bridge, root, id, text])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      handle.current?.fit()
      handle.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [active])

  return (
    <div className="terminal-surface" data-workbench-terminal={id}>
      <div className="terminal-toolbar">
        <span className="grow truncate" title={root}>
          {root}
        </span>
        <Button
          type="button"
          variant="plain"
          size="icon"
          title={t("terminal.new")}
          aria-label={t("terminal.new")}
          onClick={onNew}
        >
          <Plus className="ic ic-sm" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="plain"
          size="icon"
          title={t("terminal.kill")}
          aria-label={t("terminal.kill")}
          onClick={onClose}
        >
          <Trash2 className="ic ic-sm" aria-hidden="true" />
        </Button>
      </div>
      {error ? (
        <p className="workbench-error" role="alert">
          {error}
        </p>
      ) : null}
      {exitCode !== null ? (
        <p role="status">{fill(text("workbench.terminalExited"), { code: exitCode })}</p>
      ) : null}
      <Suspense fallback={null}>
        <TerminalView
          onReady={(terminal) => {
            handle.current = terminal
            if (terminal && output.current) {
              terminal.write(output.current)
              output.current = ""
            }
          }}
          onData={(data) => {
            if (running.current) void bridge.terminalWrite(id, data).catch(() => undefined)
          }}
          onResize={(cols, rows) => {
            if (running.current && cols > 0 && rows > 0) {
              void bridge.terminalResize(id, cols, rows).catch(() => undefined)
            }
          }}
        />
      </Suspense>
    </div>
  )
}
