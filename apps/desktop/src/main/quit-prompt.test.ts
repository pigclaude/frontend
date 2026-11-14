// 负责验证退出确认对话框：列出会中断的工作，只有选第一个按钮才离开。
import { beforeEach, describe, expect, it, vi } from "vitest"

const shown = vi.hoisted(() => ({
  options: [] as Electron.MessageBoxOptions[],
  response: 1,
}))

vi.mock("electron", () => ({
  dialog: {
    showMessageBox: async (...args: unknown[]) => {
      shown.options.push(args.at(-1) as Electron.MessageBoxOptions)
      return { response: shown.response, checkboxChecked: false }
    },
  },
}))

const { askToLeave } = await import("./quit-prompt")

beforeEach(() => {
  shown.options.length = 0
})

describe("askToLeave", () => {
  it("names the running turn and the waiting approvals, and stays on cancel", async () => {
    shown.response = 1

    await expect(askToLeave(null, { turns: 1, approvals: 2 }, "quit")).resolves.toBe(false)

    expect(shown.options[0]).toMatchObject({
      message: "还有工作在运行",
      detail: "退出会结束当前会话。\nClaude 正在回复，这一轮会被中断。\n2 个请求在等待你的审批。",
      buttons: ["退出", "继续运行"],
      cancelId: 1,
    })
  })

  it("leaves when the user picks the first button", async () => {
    shown.response = 0

    await expect(askToLeave(null, { turns: 0, approvals: 1 }, "close")).resolves.toBe(true)

    expect(shown.options[0]).toMatchObject({
      detail: "关闭窗口会结束当前会话。\n1 个请求在等待你的审批。",
      buttons: ["关闭窗口", "继续运行"],
    })
  })
})
