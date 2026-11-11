// 验证文件夹选择框只采用合法的页面文案，取消时返回 null。
import type { IpcMain, IpcMainInvokeEvent, OpenDialogOptions } from "electron"
import { describe, expect, it } from "vitest"
import { readFolderPickerLabels, registerFolderPickerIpc } from "./folder-picker"

describe("readFolderPickerLabels", () => {
  it("采用页面传来的合法文案，缺的字段用默认文案", () => {
    expect(readFolderPickerLabels({ title: "Choose a folder" })).toEqual({
      title: "Choose a folder",
      buttonLabel: "添加项目",
    })
  })

  it("丢弃空串、过长和非字符串的文案", () => {
    expect(readFolderPickerLabels({ title: "", buttonLabel: "x".repeat(81) })).toEqual({
      title: "选择项目文件夹",
      buttonLabel: "添加项目",
    })
    expect(readFolderPickerLabels("title")).toEqual({
      title: "选择项目文件夹",
      buttonLabel: "添加项目",
    })
  })
})

describe("registerFolderPickerIpc", () => {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

  function register(result: { canceled: boolean; filePaths: string[] }) {
    let handler: Handler | null = null
    const calls: OpenDialogOptions[] = []
    registerFolderPickerIpc(
      {
        handle: (_channel: string, value: Handler) => {
          handler = value
        },
      } as unknown as Pick<IpcMain, "handle">,
      async (options) => {
        calls.push(options)
        return { ...result, bookmarks: [] }
      },
    )
    const invoke = (labels?: unknown) =>
      (handler as Handler | null)?.({} as IpcMainInvokeEvent, labels)
    return { invoke, calls }
  }

  it("返回选中的文件夹，并把文案交给选择框", async () => {
    const { invoke, calls } = register({ canceled: false, filePaths: ["/work/demo"] })
    await expect(invoke({ title: "选文件夹", buttonLabel: "添加" })).resolves.toBe("/work/demo")
    expect(calls[0]).toMatchObject({
      title: "选文件夹",
      buttonLabel: "添加",
      properties: ["openDirectory", "createDirectory"],
    })
  })

  it("取消时返回 null", async () => {
    const { invoke } = register({ canceled: true, filePaths: [] })
    await expect(invoke()).resolves.toBeNull()
  })
})
