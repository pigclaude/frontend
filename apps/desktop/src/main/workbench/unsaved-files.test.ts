// 负责验证主进程对未保存文件的了解：按窗口记下报告的数量，请页面保存或放弃并等它回答，页面不回答时不卡住。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkbenchEvent } from "../../workbench-contract"
import { UnsavedFiles, type UnsavedOwner } from "./unsaved-files"

function owner(): UnsavedOwner & { sent: WorkbenchEvent[]; destroyed: boolean } {
  const page = {
    sent: [] as WorkbenchEvent[],
    destroyed: false,
    send: (_channel: string, event: WorkbenchEvent) => page.sent.push(event),
    isDestroyed: () => page.destroyed,
  }
  return page
}

function requestId(event: WorkbenchEvent | undefined): string {
  return event?.type === "unsaved-files" ? event.id : ""
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("UnsavedFiles", () => {
  it("counts what each page reports and forgets a page that goes away", () => {
    const files = new UnsavedFiles()
    const first = owner()
    const second = owner()

    files.report(first, 2)
    files.report(second, 1)
    expect(files.count()).toBe(3)
    expect(files.count(first)).toBe(2)

    files.report(first, 0)
    files.forget(second)
    expect(files.count()).toBe(0)
  })

  it("asks the page to save every file and waits for its answer", async () => {
    const files = new UnsavedFiles()
    const page = owner()
    files.report(page, 2)

    const saving = files.save(page)
    expect(page.sent).toEqual([{ type: "unsaved-files", id: expect.any(String), action: "save" }])
    files.answer(page, requestId(page.sent[0]), true)

    await expect(saving).resolves.toBe(true)
  })

  it("treats a page that does not answer or goes away as not saved", async () => {
    const files = new UnsavedFiles()
    const quiet = owner()
    files.report(quiet, 1)
    const unanswered = files.save(quiet, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(unanswered).resolves.toBe(false)

    const closing = owner()
    files.report(closing, 1)
    const gone = files.save(closing)
    files.forget(closing)
    await expect(gone).resolves.toBe(false)
  })

  it("ignores answers from another page or for unknown requests", async () => {
    const files = new UnsavedFiles()
    const page = owner()
    const stranger = owner()
    files.report(page, 1)
    const saving = files.save(page, 1000)

    files.answer(stranger, requestId(page.sent[0]), true)
    files.answer(page, "unknown", true)
    await vi.advanceTimersByTimeAsync(1000)

    await expect(saving).resolves.toBe(false)
  })

  it("asks the page to discard its changes and stops counting them once it answers", async () => {
    const files = new UnsavedFiles()
    const page = owner()
    files.report(page, 3)

    const discarding = files.discard(page)
    expect(page.sent[0]).toMatchObject({ type: "unsaved-files", action: "discard" })
    files.answer(page, requestId(page.sent[0]), true)

    await discarding
    expect(files.count()).toBe(0)
  })
})
