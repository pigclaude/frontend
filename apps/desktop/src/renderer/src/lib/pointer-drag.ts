// 负责拖动区域的指针处理：按下时捕获指针，之后移出区域也继续跟随，松开或丢失捕获时结束。
import type { PointerEvent } from "react"
import type { Area } from "../models/color-picker-model"

/** 一组可直接展开到元素上的指针事件。 */
export type PointerDragHandlers = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  onPointerUp: (event: PointerEvent<HTMLElement>) => void
}

/** 按下主键时聚焦元素并捕获指针；按下和捕获期间的每次移动都把指针坐标和元素位置交给 onMove。 */
export function pointerDragHandlers(
  onMove: (x: number, y: number, area: Area) => void,
): PointerDragHandlers {
  const report = (event: PointerEvent<HTMLElement>) =>
    onMove(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
  return {
    onPointerDown(event) {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus({ preventScroll: true })
      report(event)
    },
    onPointerMove(event) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) report(event)
    },
    onPointerUp(event) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
  }
}
