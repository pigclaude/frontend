// 负责验证文件面板的菜单行为：文件标签右键关闭标签并拦截未保存修改，文件工具栏交给本机编辑器打开和另存为。

// @vitest-environment jsdom
import userEvent from "@testing-library/user-event"
import { act } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  button,
  fakeWorkbench,
  fileEditor,
  fire,
  installNativeMenus,
  openFilesSurface,
  panelTab,
  panelTabs,
  projectRoot,
  settle,
  treeRow,
  workbenchRoot,
} from "../test-support/workbench-harness"

const screen = workbenchRoot()

async function openFiles(files: Record<string, string>) {
  const fake = fakeWorkbench(files)
  const menus = installNativeMenus(fake)
  await openFilesSurface(screen, fake)
  return { fake, menus }
}

function tab(title: string): HTMLElement {
  return panelTab(title).closest(".surface-tab") as HTMLElement
}

describe("workbench file menus", () => {
  it("closes tabs from the tab menu and asks before discarding unsaved changes", async () => {
    const { menus } = await openFiles({ "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" })
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      await fire(treeRow(name), "click", { metaKey: true })
    }
    await act(async () => userEvent.setup().type(fileEditor() as HTMLTextAreaElement, "!"))
    await settle()
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false)

    menus.answer("close-others")
    await fire(tab("a.txt"), "contextmenu", { clientX: 10, clientY: 20 })
    expect(menus.labels(0)).toEqual(["关闭标签", "关闭其他标签", "关闭所有标签"])
    expect(menus.popupMenu.mock.calls[0]?.[1]).toEqual({ x: 10, y: 20 })
    expect(confirm).toHaveBeenCalledOnce()
    expect(panelTabs().map((item) => item.title)).toEqual(["a.txt", "b.txt", "c.txt"])

    confirm.mockReturnValueOnce(true)
    menus.answer("close-others")
    await fire(tab("a.txt"), "contextmenu")
    expect(panelTabs().map((item) => item.title)).toEqual(["a.txt"])

    menus.answer("close-all")
    await fire(tab("a.txt"), "contextmenu")
    expect(panelTabs()).toEqual([])
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it("opens the file with an installed editor or the default app, and saves a copy", async () => {
    const { fake, menus } = await openFiles({ "src/main.ts": "export {}\n" })
    await fire(treeRow("src"), "click")
    await fire(treeRow("main.ts"), "click")

    await fire(button("使用系统默认应用打开"), "click")
    expect(fake.bridge.openFile).toHaveBeenLastCalledWith(projectRoot, "src/main.ts", null)

    menus.answer("open-with", "cursor")
    await fire(button("更多操作"), "click")
    expect(menus.labels(0)).toEqual([
      "打开",
      "在新标签页打开",
      "打开方式",
      "另存为…",
      "在文件管理器中显示",
      "复制绝对路径",
      "复制相对路径",
      "添加到对话",
    ])
    expect(menus.labels(1)).toEqual(["Cursor", "使用系统默认应用打开"])
    expect(fake.bridge.openFile).toHaveBeenLastCalledWith(projectRoot, "src/main.ts", "cursor")

    menus.answer("save-as")
    await fire(button("更多操作"), "click")
    expect(fake.bridge.saveAs).toHaveBeenCalledExactlyOnceWith(projectRoot, "src/main.ts")
    expect(fake.bridge.openFile).toHaveBeenCalledTimes(2)
  })
})
