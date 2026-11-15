// 验证暂时无法核验会员时桌面提示失败，并保留已经打开的工作区。
// @vitest-environment jsdom
import { act, createElement } from "react"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { expect, it } from "vitest"
import { DesktopApp } from "./app"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"

const desktop = desktopAppRoot()

it("会员网络故障期间保留主界面，恢复后移除状态提示", async () => {
  installFakeDesktopBridge()
  const membership = window.pigclaude?.membership
  if (!membership) throw new Error("测试桌面桥未安装")
  const active = await membership.inspect()
  if (!active) throw new Error("测试会员未激活")
  let emit: (view: MembershipView) => void = () => undefined
  membership.subscribe = (listener) => {
    emit = listener
    return () => {}
  }
  await act(async () => desktop.root.render(createElement(DesktopApp)))
  await flush()
  const panel = desktop.container.querySelector("main.panel")
  expect(panel).not.toBeNull()

  await act(async () => emit({ ...active, state: "network_grace", revision: 2 }))
  expect(desktop.container.querySelector("main.panel")).toBe(panel)
  expect(desktop.container.textContent).toContain("会员核验暂时失败")

  await act(async () => emit({ ...active, revision: 3 }))
  expect(desktop.container.querySelector("main.panel")).toBe(panel)
  expect(desktop.container.textContent).not.toContain("会员核验暂时失败")
})
