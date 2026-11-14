// 负责验证工作台怎样配合退出、关窗和刷新：报告未保存的文件数，有未保存的文件时拦下页面卸载，
// 按主进程的请求全部保存或全部放弃并回答结果。

// @vitest-environment jsdom
import userEvent from "@testing-library/user-event"
import { act } from "react"
import { describe, expect, it } from "vitest"
import {
  fakeWorkbench,
  fileEditor,
  fire,
  openFilesSurface,
  settle,
  treeRow,
  workbenchRoot,
} from "../test-support/workbench-harness"

const screen = workbenchRoot()
const id = "4f0c6a1e-2b3d-4c5e-8f90-a1b2c3d4e5f6"

async function editTwoFiles() {
  const fake = fakeWorkbench({ "a.txt": "a\n", "b.txt": "b\n" })
  await openFilesSurface(screen, fake)
  const user = userEvent.setup()
  for (const name of ["a.txt", "b.txt"]) {
    await fire(treeRow(name), "click", { metaKey: true })
    await act(async () => user.type(fileEditor() as HTMLTextAreaElement, "!"))
    await settle()
  }
  return fake
}

function unloadBlocked(): boolean {
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe("workbench unsaved files", () => {
  it("reports how many files are unsaved and blocks unloading only while some are", async () => {
    const fake = fakeWorkbench({ "a.txt": "a\n" })
    await openFilesSurface(screen, fake)
    expect(unloadBlocked()).toBe(false)

    await fire(treeRow("a.txt"), "click")
    await act(async () => userEvent.setup().type(fileEditor() as HTMLTextAreaElement, "!"))
    await settle()

    expect(fake.bridge.reportUnsaved).toHaveBeenLastCalledWith(1)
    expect(unloadBlocked()).toBe(true)
  })

  it("saves every unsaved file when the main process asks, then answers", async () => {
    const fake = await editTwoFiles()

    await fake.emit({ type: "unsaved-files", id, action: "save" })

    expect(fake.disk.get("a.txt")?.text).toBe("a\n!")
    expect(fake.disk.get("b.txt")?.text).toBe("b\n!")
    expect(fake.bridge.unsavedDone).toHaveBeenCalledExactlyOnceWith(id, true)
    expect(fake.bridge.reportUnsaved).toHaveBeenLastCalledWith(0)
    expect(unloadBlocked()).toBe(false)
  })

  it("answers that saving failed and keeps the change when a file changed on disk", async () => {
    const fake = await editTwoFiles()
    fake.change("a.txt", "theirs\n")

    await fake.emit({ type: "unsaved-files", id, action: "save" })

    expect(fake.bridge.unsavedDone).toHaveBeenCalledExactlyOnceWith(id, false)
    expect(fake.disk.get("a.txt")?.text).toBe("theirs\n")
    expect(fake.disk.get("b.txt")?.text).toBe("b\n!")
    expect(fake.bridge.reportUnsaved).toHaveBeenLastCalledWith(1)
    expect(screen.container.ownerDocument.body.textContent).toContain("a.txt 没能保存")
  })

  it("discards every change when the main process asks, then lets the page unload", async () => {
    const fake = await editTwoFiles()

    await fake.emit({ type: "unsaved-files", id, action: "discard" })

    expect(fake.bridge.unsavedDone).toHaveBeenCalledExactlyOnceWith(id, true)
    expect(unloadBlocked()).toBe(false)
    expect(fake.disk.get("a.txt")?.text).toBe("a\n")
    expect(fake.bridge.save).not.toHaveBeenCalled()
  })
})
