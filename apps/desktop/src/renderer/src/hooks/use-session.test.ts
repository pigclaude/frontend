// 负责验证会话控制器：订阅假桥事件、转发命令、加载模型探针并映射启动和模型错误，不启动真实 CLI。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  ClaudeModel,
  SessionBridge,
  SessionHostEvent,
  SessionStatusView,
} from "../../../main/session/session-types"
import { useSession, type SessionController } from "./use-session"

const models: ClaudeModel[] = [
  { id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true },
]

const status: SessionStatusView = {
  active: false,
  sessionId: null,
  model: null,
  permissionMode: "default",
  accountId: null,
  pendingPermissions: 0,
  turnId: null,
}

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

type FakeBridge = {
  bridge: SessionBridge
  emit: (event: SessionHostEvent) => void
}

function fakeBridge(overrides: Partial<SessionBridge> = {}): FakeBridge {
  let listener: ((event: SessionHostEvent) => void) | null = null
  const bridge: SessionBridge = {
    start: vi.fn(async () => ({ sessionId: "session-1" })),
    send: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    respondPermission: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    models: vi.fn(async () => models),
    status: vi.fn(async () => status),
    subscribe: vi.fn((next: (event: SessionHostEvent) => void) => {
      listener = next
      return () => {
        listener = null
      }
    }),
    ...overrides,
  }
  return {
    bridge,
    emit: (event) => listener?.(event),
  }
}

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
    expect(controller?.state.turns[0]?.blocks).toEqual([{ type: "text", text: "先看" }])
  })

  it("forwards start, send, permission, mode, model, cancel and stop commands", async () => {
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
    expect(bridge.send).toHaveBeenCalledWith({ text: "改一下重试逻辑" })
    expect(bridge.respondPermission).toHaveBeenCalledWith({
      requestId: "permission-1",
      decision: "allow",
    })
    expect(bridge.setMode).toHaveBeenCalledWith("plan")
    expect(bridge.setModel).toHaveBeenCalledWith("claude-opus")
    expect(bridge.cancel).toHaveBeenCalledTimes(1)
    expect(bridge.stop).toHaveBeenCalledTimes(1)
    expect(controller?.state.turns[0]?.userText).toBe("改一下重试逻辑")
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

  it("caches a successful model list until a forced refresh", async () => {
    const listModels = vi.fn(async () => models)
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
    let finish: ((list: ClaudeModel[]) => void) | null = null
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

    await act(async () => finish?.(models))
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
