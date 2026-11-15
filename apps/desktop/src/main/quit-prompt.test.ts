// 负责验证退出确认对话框：列出会中断的工作和未保存的文件，按选中的按钮得到保存、离开或留下。
import { beforeEach, describe, expect, it, vi } from "vitest"

const shown = vi.hoisted(() => ({
  options: [] as Electron.MessageBoxOptions[],
  response: 1,
  error: vi.fn(),
}))

vi.mock("electron", () => ({
  dialog: {
    showErrorBox: shown.error,
    showMessageBox: async (...args: unknown[]) => {
      shown.options.push(args.at(-1) as Electron.MessageBoxOptions)
      return { response: shown.response, checkboxChecked: false }
    },
    showMessageBoxSync: (...args: unknown[]) => {
      shown.options.push(args.at(-1) as Electron.MessageBoxOptions)
      return shown.response
    },
  },
}))

const { askToLeave, askBeforeReload, showQuitFailure } = await import("./quit-prompt")

beforeEach(() => {
  shown.options.length = 0
  shown.error.mockClear()
})

it("退出保存失败直接提示会话记录和磁盘", () => {
  showQuitFailure("session-save")
  expect(shown.error).toHaveBeenCalledExactlyOnceWith(
    "无法安全退出",
    "会话记录未能写入磁盘。请确认磁盘可用后重试退出。",
  )
})

describe("askToLeave", () => {
  it("shows the total even when no session is generating a reply", async () => {
    await askToLeave(null, { runningSessions: 2, turns: 0, approvals: 0, unsavedFiles: 0 }, "quit")

    expect(shown.options[0]?.detail).toBe("退出会结束 2 个运行中的会话。")
  })

  it("names the running turn and the waiting approvals, and stays on cancel", async () => {
    shown.response = 1

    await expect(
      askToLeave(null, { runningSessions: 1, turns: 1, approvals: 2, unsavedFiles: 0 }, "quit"),
    ).resolves.toBe("stay")

    expect(shown.options[0]).toMatchObject({
      message: "还有工作在运行",
      detail:
        "退出会结束 1 个运行中的会话。\n有 1 个正在生成的回复会被中断。\n2 个请求在等待你的审批。",
      buttons: ["退出", "继续运行"],
      cancelId: 1,
    })
  })

  it("leaves when the user picks the first button", async () => {
    shown.response = 0

    await expect(
      askToLeave(null, { runningSessions: 1, turns: 0, approvals: 1, unsavedFiles: 0 }, "close"),
    ).resolves.toBe("leave")

    expect(shown.options[0]).toMatchObject({
      detail: "关闭窗口会结束 1 个运行中的会话。\n1 个请求在等待你的审批。",
      buttons: ["关闭窗口", "继续运行"],
    })
  })

  it("offers to save unsaved files in the same question as the running turn", async () => {
    const work = { runningSessions: 1, turns: 1, approvals: 0, unsavedFiles: 2 }
    const answers = []
    for (const response of [0, 1, 2]) {
      shown.response = response
      answers.push(await askToLeave(null, work, "quit"))
    }

    expect(answers).toEqual(["save", "leave", "stay"])
    expect(shown.options).toHaveLength(3)
    expect(shown.options[0]).toMatchObject({
      message: "有文件修改还没保存",
      detail:
        "2 个文件有未保存的修改。\n退出会结束 1 个运行中的会话。\n有 1 个正在生成的回复会被中断。",
      buttons: ["保存并退出", "不保存", "取消"],
      defaultId: 0,
      cancelId: 2,
    })
  })
})

describe("askBeforeReload", () => {
  it("asks whether to save, discard or keep editing before the page reloads", () => {
    const answers = []
    for (const response of [0, 1, 2]) {
      shown.response = response
      answers.push(askBeforeReload(null, 1))
    }

    expect(answers).toEqual(["save", "leave", "stay"])
    expect(shown.options[0]).toMatchObject({
      message: "有文件修改还没保存",
      detail: "1 个文件有未保存的修改，刷新页面会丢掉它们。",
      buttons: ["保存并刷新", "不保存", "取消"],
      cancelId: 2,
    })
  })
})
