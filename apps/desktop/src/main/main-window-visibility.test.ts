// 验证退出清理失败后可以唤回已有窗口，但不会重新创建窗口或重启清理中的服务。

import { expect, it, vi } from "vitest"
import { createMainWindowVisibility } from "./main-window-visibility"

it("清理失败后唤回原窗口，窗口销毁时不重新创建", () => {
  const existing = {
    isDestroyed: vi.fn(() => false),
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
  const createWindow = vi.fn()
  const visibility = createMainWindowVisibility(() => existing, createWindow)

  visibility.startShutdown()
  visibility.restore()
  expect(existing.show).not.toHaveBeenCalled()
  visibility.shutdownFailed()
  expect(existing.show).toHaveBeenCalledOnce()
  expect(existing.focus).toHaveBeenCalledOnce()
  expect(visibility.shutdownStarted()).toBe(true)

  visibility.restoreExisting()
  expect(existing.show).toHaveBeenCalledTimes(2)
  existing.isDestroyed.mockReturnValue(true)
  visibility.restore()
  expect(createWindow).not.toHaveBeenCalled()
})
