// 负责验证工作台文件面板的页面行为：内嵌目录导航、预览标签与固定、Markdown 预览和窄面板。

// @vitest-environment jsdom
import userEvent from "@testing-library/user-event"
import { act } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  fakeWorkbench,
  fileEditor,
  panelTabs,
  settle,
  treeRow,
  workbenchRoot,
} from "../test-support/workbench-harness"

const screen = workbenchRoot()

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  )
  expect(found, "按钮 " + name).toBeDefined()
  return found as HTMLButtonElement
}

function panelTab(title: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('.right-panel [role="tab"]')].find(
    (item) => item.textContent === title,
  )
  expect(found, "标签 " + title).toBeDefined()
  return found as HTMLElement
}

async function click(element: HTMLElement, init: MouseEventInit = {}): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }))
  })
  await settle()
}

async function openFiles(files: Record<string, string>) {
  const fake = fakeWorkbench(files)
  await screen.render(fake.bridge)
  const launcher = [...document.querySelectorAll<HTMLElement>(".surface-launcher-item")].find(
    (item) => item.querySelector(".grow")?.textContent === "文件",
  )
  expect(launcher, "启动器里的文件").toBeDefined()
  await click(launcher as HTMLElement)
  return fake
}

describe("workbench files", () => {
  it("opens a clicked file in a preview tab that the next click replaces", async () => {
    await openFiles({ "notes.txt": "first\n", "todo.txt": "second\n" })

    expect(screen.container.textContent).toContain("从目录中选择一个文件")
    await click(treeRow("notes.txt"))
    expect(panelTabs()).toEqual([{ title: "notes.txt", preview: true }])
    expect(fileEditor()?.value).toBe("first\n")

    await click(treeRow("todo.txt"))
    expect(panelTabs()).toEqual([{ title: "todo.txt", preview: true }])
    expect(fileEditor()?.value).toBe("second\n")
  })

  it("keeps a previewed file open after a double-click, an edit or a ⌘-click", async () => {
    await openFiles({ "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n", "d.txt": "d\n" })
    const user = userEvent.setup()

    await click(treeRow("a.txt"))
    await click(treeRow("a.txt"))
    await act(async () => {
      treeRow("a.txt").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })
    expect(panelTabs()).toEqual([{ title: "a.txt", preview: false }])

    await click(treeRow("b.txt"))
    await act(async () => user.type(fileEditor() as HTMLTextAreaElement, "!"))
    await settle()
    expect(panelTabs()).toEqual([
      { title: "a.txt", preview: false },
      { title: "b.txt", preview: false },
    ])

    await click(treeRow("c.txt"), { metaKey: true })
    await click(treeRow("d.txt"))
    expect(panelTabs()).toEqual([
      { title: "a.txt", preview: false },
      { title: "b.txt", preview: false },
      { title: "c.txt", preview: false },
      { title: "d.txt", preview: true },
    ])

    await act(async () => {
      panelTab("d.txt").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })
    expect(panelTabs().at(-1)).toEqual({ title: "d.txt", preview: false })
  })

  it("previews Markdown files and switches to the source", async () => {
    await openFiles({ "README.md": "# Hello\n\nSome *text*.\n" })

    await click(treeRow("README.md"))
    await vi.waitFor(async () => {
      await settle()
      const preview = document.querySelector(".file-markdown-preview")
      expect(preview?.querySelector("h1, h2, h3, h4")?.textContent).toBe("Hello")
      expect(preview?.querySelector("em")?.textContent).toBe("text")
    })
    expect(fileEditor()).toBeNull()

    await click(button("源码"))
    expect(fileEditor()?.value).toBe("# Hello\n\nSome *text*.\n")
    expect(document.querySelector(".file-markdown-preview")).toBeNull()
  })

  it("shows only the navigation in a narrow panel and switches to the file once picked", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    )
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320)
    try {
      await openFiles({ "notes.txt": "hello\n" })
      const content = () => document.querySelector<HTMLElement>(".file-view-content")
      expect(content()?.hidden).toBe(true)

      await click(treeRow("notes.txt"))
      expect(content()?.hidden).toBe(false)
      expect(document.querySelector('[role="treeitem"]')).toBeNull()
      expect(fileEditor()?.value).toBe("hello\n")

      await click(button("显示文件导航"))
      expect(content()?.hidden).toBe(true)
      expect(treeRow("notes.txt")).toBeDefined()
    } finally {
      width.mockRestore()
    }
  })

  it("keeps drafts across tabs and does not overwrite a file changed on disk", async () => {
    const fake = await openFiles({ "a.txt": "a\n", "b.txt": "b\n" })
    const user = userEvent.setup()
    await click(treeRow("a.txt"), { metaKey: true })
    await act(async () => user.type(fileEditor() as HTMLTextAreaElement, "mine"))
    await click(treeRow("b.txt"), { metaKey: true })
    expect(fileEditor()?.value).toBe("b\n")

    await click(panelTab("a.txt"))
    expect(fileEditor()?.value).toBe("a\nmine")
    fake.change("a.txt", "theirs\n")
    await click(button("保存"))
    expect(screen.container.textContent).toContain("这个文件在磁盘上被修改过。")
    expect(fake.disk.get("a.txt")?.text).toBe("theirs\n")

    await click(button("仍然保存"))
    expect(fake.disk.get("a.txt")?.text).toBe("a\nmine")
    expect(screen.container.textContent).not.toContain("这个文件在磁盘上被修改过。")
  })
})
