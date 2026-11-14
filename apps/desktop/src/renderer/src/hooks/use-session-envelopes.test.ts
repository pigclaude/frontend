// 负责验证会话控制器接收信封：按序号去重、发现断号时按序号补拉后再按顺序归并，
// 以及刷新后从信封认出要发命令的会话。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionEnvelope } from "../../../main/session/session-envelope"
import type { SessionBridge, SessionHostEvent } from "../../../main/session/session-types"
import { fakeSessionBridge } from "../test-support/session-bridge-fake"
import { useSession, type SessionController } from "./use-session"

let root: Root
let container: HTMLDivElement
let controller: SessionController | null = null

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  controller = null
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function Probe({ bridge }: { bridge: SessionBridge }) {
  controller = useSession(bridge)
  return null
}

async function render(bridge: SessionBridge): Promise<void> {
  await act(async () => root.render(createElement(Probe, { bridge })))
  await act(async () => undefined)
}

function kept(seq: number, event: SessionHostEvent, sessionId = "session-1"): SessionEnvelope {
  return { version: 1, sessionId, seq, at: `2026-11-14T01:00:0${seq}.000Z`, event }
}

function failure(message: string): SessionHostEvent {
  return { type: "error", code: "STEP_FAILED", message }
}

function errorsOfLastTurn(): string[] {
  return controller?.state.turns.at(-1)?.errors.map((error) => error.message) ?? []
}

describe("useSession envelopes", () => {
  it("applies an event with a seq it already has only once", async () => {
    const { bridge, push } = fakeSessionBridge()
    await render(bridge)

    await act(async () => {
      push(kept(1, failure("第一次")))
      push(kept(1, failure("第一次")))
      push(kept(2, failure("第二次")))
    })

    expect(errorsOfLastTurn()).toEqual(["第一次", "第二次"])
    expect(bridge.events).not.toHaveBeenCalled()
  })

  it("fetches the missing seqs when one is skipped and applies everything in order", async () => {
    const events = vi.fn(async () => [kept(2, failure("补回来的")), kept(3, failure("跳过来的"))])
    const { bridge, push } = fakeSessionBridge({ events })
    await render(bridge)

    await act(async () => {
      push(kept(1, failure("最早的")))
      push(kept(3, failure("跳过来的")))
    })

    expect(events).toHaveBeenCalledWith({ sessionId: "session-1", afterSeq: 1 })
    expect(errorsOfLastTurn()).toEqual(["最早的", "补回来的", "跳过来的"])
  })

  it("keeps envelopes that arrive during a fill until the gap is closed", async () => {
    let finish: (page: SessionEnvelope[]) => void = () => undefined
    const events = vi.fn(
      () =>
        new Promise<SessionEnvelope[]>((resolve) => {
          finish = resolve
        }),
    )
    const { bridge, push } = fakeSessionBridge({ events })
    await render(bridge)

    await act(async () => {
      push(kept(2, failure("第二条")))
      push(kept(3, failure("第三条")))
    })
    expect(errorsOfLastTurn()).toEqual([])

    await act(async () => finish([kept(1, failure("第一条")), kept(2, failure("第二条"))]))

    expect(events).toHaveBeenCalledWith({ sessionId: "session-1", afterSeq: 0 })
    expect(errorsOfLastTurn()).toEqual(["第一条", "第二条", "第三条"])
  })

  it("still applies what it has when the fill fails", async () => {
    const events = vi.fn(async () => {
      throw new Error("SESSION_NOT_FOUND: 会话不存在")
    })
    const { bridge, push } = fakeSessionBridge({ events })
    await render(bridge)

    await act(async () => {
      push(kept(4, failure("迟到的")))
    })

    expect(errorsOfLastTurn()).toEqual(["迟到的"])
  })

  it("sends commands to the session its envelopes came from after a reload", async () => {
    const { bridge, push } = fakeSessionBridge()
    await render(bridge)

    await act(async () => {
      push(kept(1, { type: "mode", permissionMode: "default" }, "session-9"))
    })
    await act(async () => {
      await controller?.send("接着做")
    })

    expect(bridge.send).toHaveBeenCalledWith({ sessionId: "session-9", text: "接着做" })
  })
})
