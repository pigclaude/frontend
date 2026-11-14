// 验证项目草稿的输入和选项在离开后仍可恢复，并且启动失败只在原草稿里显示。
// @vitest-environment jsdom
import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { DesktopApp } from "./app"
import { clickButton, typeAndSend } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeSessionBridge } from "./test-support/session-bridge-fake"

const app = desktopAppRoot()

function editor(): HTMLElement {
  const node = app.container.querySelector<HTMLElement>(".composer .tiptap")
  if (!node) throw new Error("草稿缺少输入框")
  return node
}

async function newDraft(project: string): Promise<void> {
  const row = [...app.container.querySelectorAll("button.proj")].find(
    (item) => item.textContent?.trim() === project,
  )
  const button = row?.closest(".proj-row")?.querySelector<HTMLElement>(".proj-add")
  await clickButton(button ?? undefined, `${project} 的新会话按钮`)
  await flush()
}

async function openPicker(): Promise<void> {
  await clickButton(
    app.container.querySelector<HTMLElement>(".model-chip") ?? undefined,
    "模型选择器",
  )
}

async function choosePermission(label: string): Promise<void> {
  await clickButton(
    document.querySelector<HTMLElement>(".model-permission-btn") ?? undefined,
    "权限",
  )
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((node) =>
    node.textContent?.startsWith(label),
  )
  await clickButton(item, label)
}

it("keeps different project draft choices and recovers the original text after startup fails", async () => {
  installFakeDesktopBridge()
  const start = vi.fn(async () => {
    throw new Error("NO_AVAILABLE_ACCOUNT: 没有可用的 Claude 账号")
  })
  const session = fakeSessionBridge({ start })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = session.bridge
  const accounts = window.pigclaude.claudeAccounts
  if (!accounts) throw new Error("号池桥尚未安装")
  const [account] = await accounts.list()
  if (!account) throw new Error("缺少测试账号")
  accounts.list = async () => [account, { ...account, id: "acc-home", displayName: "家用号" }]
  session.bridge.models = async () => ({
    models: [
      { id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true },
      { id: "claude-opus", displayName: "Opus", description: "", isDefault: false },
    ],
    cliError: null,
  })
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()

  await openPicker()
  await clickButton(
    document.querySelector<HTMLElement>('[role="tab"][aria-label="家用号 · 系统网络"]') ??
      undefined,
    "家用号",
  )
  const opus = await vi.waitFor(() => {
    const option = [...document.querySelectorAll<HTMLElement>('button, [role="option"]')].find(
      (node) => node.querySelector(".model-row-name")?.textContent?.trim() === "Opus",
    )
    if (!option) throw new Error("模型目录里没有 Opus")
    return option
  })
  await clickButton(opus, "Opus")
  await choosePermission("接受编辑")
  await act(async () => userEvent.setup({ delay: null }).keyboard("{Escape}"))
  await newDraft("web")
  expect(app.container.querySelector(".model-chip")?.getAttribute("aria-label")).not.toContain(
    "家用号",
  )
  await openPicker()
  expect(document.querySelector(".model-permission-btn")?.getAttribute("aria-label")).toBe(
    "权限: 监督审批",
  )
  await act(async () => userEvent.setup({ delay: null }).keyboard("{Escape}"))
  await newDraft("api")
  expect(app.container.querySelector(".model-chip")?.getAttribute("aria-label")).toContain("家用号")
  expect(app.container.querySelector(".model-chip")?.textContent).toContain("Opus")
  await openPicker()
  expect(document.querySelector(".model-permission-btn")?.getAttribute("aria-label")).toBe(
    "权限: 接受编辑",
  )
  await act(async () => userEvent.setup({ delay: null }).keyboard("{Escape}"))
  expect(start).not.toHaveBeenCalled()

  await typeAndSend(app.container, "保留这段草稿")
  await flush()
  expect(start).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      workspace: "/work/api",
      permissionMode: "acceptEdits",
      model: "claude-opus",
      accountId: "acc-home",
    }),
  )
  expect(app.container.querySelector('.new-thread-view [role="alert"]')?.textContent).toContain(
    "没有可用的 Claude 账号，请添加或重新授权",
  )
  expect(editor().textContent).toBe("保留这段草稿")
  await newDraft("web")
  expect(editor().textContent).toBe("")
  expect(app.container.querySelector('.new-thread-view [role="alert"]')).toBeNull()
  await newDraft("api")
  expect(editor().textContent).toBe("保留这段草稿")
  expect(session.bridge.send).not.toHaveBeenCalled()
})
