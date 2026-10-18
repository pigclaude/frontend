// 负责在渲染进程用 canvas 画出 macOS Dock 图标，输出 PNG data URL；依赖浏览器，不做单元测试。
import type { AppearanceSettings } from "../models/appearance-settings"

type DockIconKind = AppearanceSettings["dockIcon"]

const size = 1024
const cornerRadius = size * 0.225
const glyphScale = 23.5
const glyphOffset = (size - 24 * glyphScale) / 2
const strokeWidth = 1.45 * glyphScale

const looks: Record<DockIconKind, { from: string; to: string; ink: string }> = {
  classic: { from: "#FFFFFF", to: "#F1F1F3", ink: "#18181B" },
  pink: { from: "#FFD1DC", to: "#F59AB5", ink: "#7A1838" },
  night: { from: "#2B2D5C", to: "#0F1024", ink: "#C7C9FF" },
}

/** 把一种 Dock 图标画成 1024×1024 的圆角方形，中间描边 snout 标记，返回 PNG data URL。 */
export async function renderDockIcon(kind: DockIconKind): Promise<string> {
  const look = looks[kind]
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法创建画布")

  const gradient = context.createLinearGradient(0, 0, 0, size)
  gradient.addColorStop(0, look.from)
  gradient.addColorStop(1, look.to)
  context.fillStyle = gradient
  context.beginPath()
  context.roundRect(0, 0, size, size, cornerRadius)
  context.fill()

  context.save()
  context.translate(glyphOffset, glyphOffset)
  context.scale(glyphScale, glyphScale)
  context.strokeStyle = look.ink
  context.lineWidth = strokeWidth / glyphScale
  context.lineCap = "round"
  context.lineJoin = "round"
  context.beginPath()
  context.roundRect(3, 6, 18, 12.5, 6.25)
  context.moveTo(9.5, 10.3)
  context.lineTo(9.5, 14.2)
  context.moveTo(14.5, 10.3)
  context.lineTo(14.5, 14.2)
  context.stroke()
  context.restore()

  return canvas.toDataURL("image/png")
}
