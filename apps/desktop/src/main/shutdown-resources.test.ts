// 验证应用退出时先关闭浏览器和授权资源，再关闭 Xray。

import { expect, it, vi } from "vitest"
import { shutdownDesktopResources } from "./shutdown-resources"

it("等待账号资源清理成功后才关闭 Xray", async () => {
  let finish: () => void = () => undefined
  const accounts = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  const xray = vi.fn(async () => undefined)
  const shutdown = shutdownDesktopResources({ accounts, xray })
  await Promise.resolve()
  expect(xray).not.toHaveBeenCalled()
  finish()
  await shutdown
  expect(xray).toHaveBeenCalledTimes(1)
})

it("账号资源清理失败时不提前关闭 Xray", async () => {
  const xray = vi.fn(async () => undefined)
  await expect(
    shutdownDesktopResources({
      accounts: async () => {
        throw new Error("未能停止浏览器")
      },
      xray,
    }),
  ).rejects.toThrow()
  expect(xray).not.toHaveBeenCalled()
})

it("会话关闭完成后才关闭后台服务", async () => {
  let finish: () => void = () => undefined
  const sessions = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  const composition = vi.fn(async () => undefined)
  const shutdown = shutdownDesktopResources({ sessions, composition, xray: async () => undefined })
  await Promise.resolve()
  expect(composition).not.toHaveBeenCalled()
  finish()
  await shutdown
  expect(composition).toHaveBeenCalledTimes(1)
})

it("在系统退出回调返回前开始关停会话、账号和终端", async () => {
  const accounts = vi.fn(() => Promise.resolve())
  const sessions = vi.fn(() => Promise.resolve())
  const workbench = vi.fn(() => Promise.resolve())
  const composition = vi.fn(() => Promise.resolve())
  const shutdown = shutdownDesktopResources({
    accounts,
    sessions,
    workbench,
    composition,
    xray: async () => undefined,
  })
  expect(sessions).toHaveBeenCalledOnce()
  expect(accounts).toHaveBeenCalledOnce()
  expect(workbench).toHaveBeenCalledOnce()
  expect(composition).not.toHaveBeenCalled()
  await shutdown
  expect(composition).toHaveBeenCalledOnce()
})
