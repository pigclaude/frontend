// 负责验证会话控制器：订阅假桥事件、带会话 id 转发命令、加载模型探针并映射启动和模型错误，不启动真实 CLI。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  ClaudeModel,
  SessionBridge,
  SessionModelCatalog,
} from "../../../main/session/session-types"
import {
  fakeCatalog as catalog,
  fakeModels as models,
  fakeSessionBridge as fakeBridge,
} from "../test-support/session-bridge-fake"
import { sessionRecord } from "../models/session-event-store"
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
  vi.useRealTimers()
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

describe("useSession", () => {
  it("subscribes to bridge events, loads status and models on demand", async () => {
    const { bridge, emit } = fakeBridge()
    await render(bridge)

    expect(bridge.status).toHaveBeenCalledTimes(1)
    expect(bridge.models).not.toHaveBeenCalled()

    await act(async () => {
      await controller?.refreshModels()
    })
    await act(async () => {
      emit({
        type: "started",
        sessionId: "session-1",
        model: "claude-sonnet",
        tools: [],
        permissionMode: "default",
      })
    })
    await act(async () => {
      emit({ type: "delta", text: "先看", thinking: false, blockIndex: 0 })
    })

    expect(bridge.subscribe).toHaveBeenCalledTimes(1)
    expect(bridge.models).toHaveBeenCalledTimes(1)
    expect(controller?.status).toMatchObject({ active: false })
    expect(controller?.models).toEqual(models)
    const state = controller?.state
    expect(state === undefined ? null : sessionRecord(state.events, state.sessionId).live).toEqual({
      text: "先看",
      reasoning: "",
    })
  })

  it("forwards start, then sends every command to the started session", async () => {
    const { bridge } = fakeBridge()
    await render(bridge)

    await act(async () => {
      await controller?.start({
        workspace: "/Users/me/app",
        permissionMode: "default",
        thinking: "medium",
      })
    })
    expect(controller?.state.started).toBe(true)

    await act(async () => {
      await controller?.send("改一下重试逻辑")
    })
    await act(async () => {
      await controller?.respondPermission("permission-1", "allow")
    })
    await act(async () => {
      await controller?.answerQuestion("question-1", ["Blue"])
    })
    await act(async () => {
      await controller?.setMode("plan")
    })
    await act(async () => {
      await controller?.setModel("claude-opus")
    })
    await act(async () => {
      await controller?.cancel()
    })
    await act(async () => {
      await controller?.stop()
    })

    expect(bridge.start).toHaveBeenCalledWith({
      workspace: "/Users/me/app",
      permissionMode: "default",
      thinking: "medium",
    })
    const target = { sessionId: "session-1" }
    expect(bridge.send).toHaveBeenCalledWith({ ...target, text: "改一下重试逻辑" })
    expect(bridge.respondPermission).toHaveBeenCalledWith({
      ...target,
      requestId: "permission-1",
      decision: "allow",
    })
    expect(bridge.answerQuestion).toHaveBeenCalledWith({
      ...target,
      requestId: "question-1",
      answers: ["Blue"],
    })
    expect(bridge.setMode).toHaveBeenCalledWith({ ...target, mode: "plan" })
    expect(bridge.setModel).toHaveBeenCalledWith({ ...target, model: "claude-opus" })
    expect(bridge.cancel).toHaveBeenCalledWith(target)
    expect(bridge.stop).toHaveBeenCalledWith(target)
    expect(controller?.state.turns[0]?.userText).toBe("改一下重试逻辑")
  })

  it("stops a session that is still starting once its id is known", async () => {
    let finishStart: (value: { sessionId: string }) => void = () => undefined
    const { bridge } = fakeBridge({
      start: () =>
        new Promise((resolve) => {
          finishStart = resolve
        }),
    })
    await render(bridge)

    let stopping: Promise<void> | undefined
    await act(async () => {
      void controller?.start({ workspace: "/Users/me/app", permissionMode: "default" })
      stopping = controller?.stop()
    })
    expect(bridge.stop).not.toHaveBeenCalled()
    await act(async () => {
      finishStart({ sessionId: "session-2" })
      await stopping
    })

    expect(bridge.stop).toHaveBeenCalledWith({ sessionId: "session-2" })
    expect(controller?.state.ended).toBe(true)
  })

  it("does not take a new message until the main process ends the turn, even after a result", async () => {
    const send = vi.fn(async () => undefined)
    const { bridge, emit } = fakeBridge({ send })
    await render(bridge)
    await act(async () => {
      await controller?.start({ workspace: "/Users/me/app", permissionMode: "default" })
    })

    let first: boolean | undefined = undefined
    await act(async () => {
      await controller?.send("first")
      first = await controller?.send("second")
    })

    expect(first).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    expect(controller?.state.turns).toHaveLength(1)
    expect(controller?.state.turns[0]?.userText).toBe("first")

    let whileBackground: boolean | undefined = undefined
    await act(async () => {
      emit({ type: "turn-started", turnId: "main-turn-1" })
      emit({
        type: "result",
        subtype: "success",
        isError: false,
        durationMs: 10,
        numTurns: 2,
        stopReason: "end_turn",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      })
    })
    await act(async () => {
      whileBackground = await controller?.send("third")
    })

    expect(whileBackground).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    expect(controller?.state.turns[0]?.status).toBe("streaming")

    await act(async () => {
      emit({ type: "turn-ended", turnId: "main-turn-1", status: "completed", errorCode: null })
    })
    await act(async () => {
      await controller?.send("third")
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(controller?.state.turns.map((turn) => turn.userText)).toEqual(["first", "third"])
  })

  it("maps a rejected start to Chinese text without the Electron prefix", async () => {
    const { bridge } = fakeBridge({
      start: async () => {
        throw new Error(
          "Error invoking remote method 'pigclaude:session-start': Error: NO_AVAILABLE_ACCOUNT: 没有可用的 Claude 账号",
        )
      },
    })
    await render(bridge)

    await act(async () => {
      await controller?.start({ workspace: "/Users/me/app", permissionMode: "default" })
    })

    expect(controller?.state.started).toBe(false)
    expect(controller?.state.error?.message).toBe("没有可用的 Claude 账号，请添加或重新授权")
  })

  it("exposes model probe loading and failure states", async () => {
    let reject: ((error: Error) => void) | null = null
    const { bridge } = fakeBridge({
      models: () =>
        new Promise((_resolve, onReject) => {
          reject = onReject
        }),
    })
    await render(bridge)
    await act(async () => {
      void controller?.refreshModels()
    })

    expect(controller?.modelsLoading).toBe(true)
    await act(async () => reject?.(new Error("CLAUDE_RUNTIME_UNAVAILABLE: 找不到 CLI")))
    await act(async () => undefined)

    expect(controller?.modelsLoading).toBe(false)
    expect(controller?.modelsError).toBe("Claude Code 不可用，请检查安装")
  })

  it("keeps the built-in list usable and says why Claude Code could not list models", async () => {
    const builtin: ClaudeModel[] = [
      { id: "default", displayName: "Default (recommended)", description: "", isDefault: true },
    ]
    const { bridge } = fakeBridge({
      models: async () => ({
        models: builtin,
        cliError: "CLAUDE_RUNTIME_UNAVAILABLE: 找不到 CLI",
      }),
    })
    await render(bridge)

    await act(async () => {
      await controller?.refreshModels()
    })

    expect(controller?.models).toEqual(builtin)
    expect(controller?.modelsError).toBeNull()
    expect(controller?.modelsCliError).toBe("Claude Code 不可用，请检查安装")
  })

  it("caches a successful model list until a forced refresh", async () => {
    const listModels = vi.fn(async () => catalog)
    const { bridge } = fakeBridge({ models: listModels })
    await render(bridge)

    await act(async () => {
      await controller?.refreshModels()
    })
    await act(async () => {
      await controller?.refreshModels()
    })
    expect(listModels).toHaveBeenCalledTimes(1)

    await act(async () => {
      await controller?.refreshModels(true)
    })
    expect(listModels).toHaveBeenCalledTimes(2)
  })

  it("times out a hanging model probe and can cancel it", async () => {
    vi.useFakeTimers()
    let finish: ((result: SessionModelCatalog) => void) | null = null
    const { bridge } = fakeBridge({
      models: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    await render(bridge)

    await act(async () => {
      void controller?.refreshModels()
    })
    expect(controller?.modelsLoading).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(controller?.modelsLoading).toBe(false)
    expect(controller?.modelsError).toBe("模型查询超时，请重试")

    await act(async () => {
      void controller?.refreshModels(true)
    })
    expect(controller?.modelsLoading).toBe(true)
    await act(async () => controller?.cancelModels())
    expect(controller?.modelsLoading).toBe(false)
    expect(controller?.modelsError).toBe("已取消模型查询")

    await act(async () => finish?.(catalog))
    expect(controller?.models).toEqual([])
    vi.useRealTimers()
  })

  it("keeps the session active when stop fails", async () => {
    const { bridge } = fakeBridge({
      stop: async () => {
        throw new Error("SDK_ERROR: 停止失败")
      },
    })
    await render(bridge)
    await act(async () => {
      await controller?.start({ workspace: "/Users/me/app", permissionMode: "default" })
    })
    await act(async () => {
      await controller?.stop()
    })

    expect(controller?.state.ended).toBe(false)
    expect(controller?.state.started).toBe(true)
    expect(controller?.state.error?.message).toBe("Claude 返回错误")
  })

  it("reports a missing bridge instead of throwing", async () => {
    await act(async () =>
      root.render(
        createElement(function MissingProbe() {
          controller = useSession(null)
          return null
        }),
      ),
    )

    await act(async () => {
      await controller?.start({ workspace: "/Users/me/app", permissionMode: "default" })
    })

    expect(controller?.state.error?.message).toBe("桌面会话服务不可用")
  })
})
