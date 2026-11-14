// 负责验证会话回合检查点：同一项目按调用顺序记录，完成后通知窗口，Git 失败不影响会话。
import type { WebContents } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { captureSessionCheckpoint } from "./session-checkpoints"

const { captures } = vi.hoisted(() => ({
  captures: [] as {
    root: string
    phase: string | undefined
    resolve: () => void
    reject: (error: Error) => void
  }[],
}))

vi.mock("./git-checkpoints", () => ({
  captureWorkbenchCheckpoint: (root: string, phase?: string) =>
    new Promise<string>((resolve, reject) => {
      captures.push({
        root,
        phase,
        resolve: () => resolve(`${phase ?? "manual"}-id`),
        reject,
      })
    }),
}))

let caseNumber = 0
let app: string
let site: string

function ownerWindow() {
  const state = { destroyed: false }
  const send = vi.fn()
  const owner = { isDestroyed: () => state.destroyed, send } as unknown as WebContents
  return { owner, send, close: () => (state.destroyed = true) }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  captures.length = 0
  caseNumber += 1
  app = `/projects/app-${caseNumber}`
  site = `/projects/site-${caseNumber}`
})

describe("session checkpoints", () => {
  it("records one project's checkpoints one at a time in call order", async () => {
    const { owner } = ownerWindow()
    const baseline = captureSessionCheckpoint(owner, app, "baseline")
    const final = captureSessionCheckpoint(owner, app, "final")
    await settle()
    expect(captures.map((item) => item.phase)).toEqual(["baseline"])

    captures[0]?.resolve()
    await baseline
    await settle()
    expect(captures.map((item) => item.phase)).toEqual(["baseline", "final"])
    captures[1]?.resolve()
    await expect(final).resolves.toBeUndefined()
  })

  it("does not hold one project behind another", async () => {
    const { owner } = ownerWindow()
    void captureSessionCheckpoint(owner, app, "baseline")
    void captureSessionCheckpoint(owner, site, "baseline")
    await settle()

    expect(captures.map((item) => item.root)).toEqual([app, site])
  })

  it("tells the window once a checkpoint is recorded", async () => {
    const { owner, send } = ownerWindow()
    const pending = captureSessionCheckpoint(owner, app, "final")
    await settle()
    expect(send).not.toHaveBeenCalled()

    captures[0]?.resolve()
    await pending

    expect(send).toHaveBeenCalledWith("pigclaude:workbench-event", {
      type: "checkpoints-changed",
      id: app,
    })
  })

  it("never rejects when Git is unavailable and keeps later checkpoints going", async () => {
    const { owner, send } = ownerWindow()
    const failed = captureSessionCheckpoint(owner, app, "baseline")
    const next = captureSessionCheckpoint(owner, app, "final")
    await settle()
    captures[0]?.reject(new Error("WORKBENCH_GIT_REQUIRED"))

    await expect(failed).resolves.toBeUndefined()
    await settle()
    expect(captures.map((item) => item.phase)).toEqual(["baseline", "final"])
    captures[1]?.resolve()
    await next
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("does not message a window that closed while Git was still recording", async () => {
    const { owner, send, close } = ownerWindow()
    const pending = captureSessionCheckpoint(owner, app, "baseline")
    await settle()
    close()
    captures[0]?.resolve()
    await pending

    expect(send).not.toHaveBeenCalled()
  })
})
