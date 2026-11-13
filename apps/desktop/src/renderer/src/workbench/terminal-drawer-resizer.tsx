// 处理底部终端的水平分隔条，让尺寸随可用空间收缩并支持键盘调整。
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { useLocale } from "@pigclaude/ui-primitives"

const minimum = 140
const initial = 260
const step = 24

/** 提供底部终端的拖动、方向键、复位及无障碍尺寸。 */
export function TerminalDrawerResizer({
  height,
  onChange,
  open,
}: {
  height: number
  onChange: (height: number) => void
  open: boolean
}) {
  const { t } = useLocale()
  const handle = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; startY: number; startHeight: number } | null>(null)
  const [maximum, setMaximum] = useState(initial)
  const [dragging, setDragging] = useState(false)

  useLayoutEffect(() => {
    const panel = handle.current?.closest(".panel")
    if (!open || !panel) return
    const measure = () => {
      if (panel.clientHeight === 0) return
      const max = Math.max(minimum, Math.round(panel.clientHeight * 0.7))
      setMaximum(max)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [open])

  useLayoutEffect(() => {
    if (open && height > maximum) onChange(maximum)
  }, [height, maximum, onChange, open])

  useLayoutEffect(() => {
    if (!dragging || !open) return
    document.body.classList.add("is-resizing-rows")
    return () => document.body.classList.remove("is-resizing-rows")
  }, [dragging, open])

  function change(value: number): void {
    onChange(Math.max(minimum, Math.min(maximum, Math.round(value))))
  }

  function stop(): void {
    const current = drag.current
    drag.current = null
    if (current && handle.current?.hasPointerCapture(current.id)) {
      handle.current.releasePointerCapture(current.id)
    }
    setDragging(false)
  }

  function start(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: event.pointerId, startY: event.clientY, startHeight: height }
    setDragging(true)
  }

  function move(event: PointerEvent<HTMLDivElement>): void {
    const current = drag.current
    if (current?.id !== event.pointerId) return
    change(current.startHeight + current.startY - event.clientY)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault()
      event.stopPropagation()
      change(drag.current.startHeight)
      stop()
      return
    }
    const values: Record<string, number> = {
      ArrowUp: height + step,
      ArrowDown: height - step,
      Home: minimum,
      End: maximum,
    }
    const next = values[event.key]
    if (next === undefined) return
    event.preventDefault()
    change(next)
  }

  return (
    <div
      ref={handle}
      className="terminal-drawer-resizer"
      role="separator"
      tabIndex={0}
      aria-label={t("panel.terminalDrawer")}
      aria-orientation="horizontal"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={height}
      data-resizing={dragging || undefined}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={() => change(initial)}
    />
  )
}
