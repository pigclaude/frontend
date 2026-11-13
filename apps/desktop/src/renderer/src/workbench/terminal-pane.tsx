// 将真实 PTY 连接到 Pigcode 的 xterm 视图，切换标签或隐藏面板时保留会话。
import { Loader2, Plus, Trash2 } from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Button, EmptyState, useLocale } from "@pigclaude/ui-primitives"
import type { TerminalHandle } from "@pigclaude/ui-workbench"
import type { WorkbenchBridge, WorkbenchTerminalInfo } from "../../../workbench-contract"
import { fill, useText } from "../locale/text"
import { workbenchError } from "./workbench-errors"

type Props = {
  bridge: WorkbenchBridge
  root: string
  id: string
  active: boolean
  focusOnActivate?: boolean
  onNew?: () => void
  onClose?: () => void
  onOpened?: (info: WorkbenchTerminalInfo) => void
  onExit?: () => void
}

const TerminalView = lazy(async () => ({
  default: (await import("@pigclaude/ui-workbench/terminal-view")).TerminalView,
}))

/** 先测量 xterm，再在该尺寸下启动 shell；卸载时等待在途的打开操作。 */
export function TerminalPane({
  bridge,
  root,
  id,
  active,
  focusOnActivate = true,
  onNew,
  onClose,
  onOpened,
  onExit,
}: Props) {
  const { t } = useLocale()
  const { t: text } = useText()
  const handle = useRef<TerminalHandle | null>(null)
  const size = useRef<{ cols: number; rows: number } | null>(null)
  const output = useRef("")
  const pendingInput = useRef("")
  const terminalOperation = useRef(Promise.resolve())
  const running = useRef(false)
  const callbacks = useRef({ text, onOpened, onExit, shouldFocus: active && focusOnActivate })
  callbacks.current = { text, onOpened, onExit, shouldFocus: active && focusOnActivate }
  const [measured, setMeasured] = useState(false)
  const [opened, setOpened] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!measured) return
    let cancelled = false
    let exited = false
    const stop = bridge.subscribe((event) => {
      if (event.id !== id) return
      if (event.type === "terminal-data") {
        if (handle.current) handle.current.write(event.data)
        else output.current = (output.current + event.data).slice(-64 * 1024)
      }
      if (event.type === "terminal-exit") {
        exited = true
        running.current = false
        setExitCode(event.exitCode)
        callbacks.current.onExit?.()
      }
    })
    const started = terminalOperation.current.then(async () => {
      const opening = size.current
      if (cancelled || !opening) return
      const info = await bridge.terminalOpen(root, id, opening.cols, opening.rows)
      if (cancelled || exited) return
      running.current = true
      setOpened(true)
      if (info) callbacks.current.onOpened?.(info)
      const latest = size.current
      if (latest && (!info || latest.cols !== opening.cols || latest.rows !== opening.rows)) {
        void bridge.terminalResize(id, latest.cols, latest.rows).catch(() => undefined)
      }
      if (pendingInput.current) {
        void bridge.terminalWrite(id, pendingInput.current).catch(() => undefined)
        pendingInput.current = ""
      }
    })
    void started.catch((failure: unknown) => {
      if (!cancelled) setError(workbenchError(failure, callbacks.current.text))
    })
    return () => {
      cancelled = true
      running.current = false
      stop()
      terminalOperation.current = started
        .then(() => bridge.terminalClose(id))
        .catch(() => undefined)
    }
  }, [bridge, root, id, measured])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      handle.current?.fit()
      if (focusOnActivate) handle.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [active, focusOnActivate])

  return (
    <div className="terminal-surface" data-workbench-terminal={id}>
      {onNew && onClose ? (
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
      ) : null}
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
            if (callbacks.current.shouldFocus) terminal?.focus()
          }}
          onData={(data) => {
            if (running.current) void bridge.terminalWrite(id, data).catch(() => undefined)
            else if (!opened && !error && exitCode === null)
              pendingInput.current = (pendingInput.current + data).slice(-16 * 1024)
          }}
          onResize={(cols, rows) => {
            if (cols < 1 || rows < 1) return
            const next = { cols: Math.min(cols, 500), rows: Math.min(rows, 300) }
            size.current = next
            setMeasured(true)
            if (running.current)
              void bridge.terminalResize(id, next.cols, next.rows).catch(() => undefined)
          }}
        />
      </Suspense>
      {!opened && !error && exitCode === null ? (
        <div className="terminal-surface-loading" role="status">
          <EmptyState
            icon={<Loader2 className="ic spin" aria-hidden="true" />}
            title={t("workbench.terminalOpening")}
          />
        </div>
      ) : null}
    </div>
  )
}
