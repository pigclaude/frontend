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

let run = 0
let app: string
let site: string

function window(destroyed = false) {
  const send = vi.fn()
  return { owner: { isDestroyed: () => destroyed, send } as unknown as WebContents, send }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

beforeEach(() => {
  captures.length = 0
  run += 1
  app = `/projects/app-${run}`
  site = `/projects/site-${run}`
})

describe("session checkpoints", () => {
  it("records one project's checkpoints one at a time in call order", async () => {
    const { owner } = window()
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
    const { owner } = window()
    void captureSessionCheckpoint(owner, app, "baseline")
    void captureSessionCheckpoint(owner, site, "baseline")
    await settle()

    expect(captures.map((item) => item.root)).toEqual([app, site])
  })

  it("tells the window once a checkpoint is recorded", async () => {
    const { owner, send } = window()
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
    const { owner, send } = window()
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

  it("does not message a window that has already closed", async () => {
    const { owner, send } = window(true)
    const pending = captureSessionCheckpoint(owner, app, "baseline")
    await settle()
    captures[0]?.resolve()
    await pending

    expect(send).not.toHaveBeenCalled()
  })
})
