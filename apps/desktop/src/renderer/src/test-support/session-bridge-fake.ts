// 负责会话控制器测试共用的假会话桥：命令都是记录调用的假函数，事件按会话宿主的规则包成信封推送。

import { vi } from "vitest"
import { sessionEventKinds, type SessionEnvelope } from "../../../main/session/session-envelope"
import type {
  ClaudeModel,
  SessionBridge,
  SessionHostEvent,
  SessionModelCatalog,
  SessionStatusView,
} from "../../../main/session/session-types"

/** 假桥默认列出的模型。 */
export const fakeModels: ClaudeModel[] = [
  { id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true },
]

/** 假桥默认的模型目录。 */
export const fakeCatalog: SessionModelCatalog = { models: fakeModels, cliError: null }

/** 假桥默认的会话快照：没有活动会话。 */
export const idleStatus: SessionStatusView = {
  active: false,
  sessionId: null,
  model: null,
  permissionMode: "default",
  accountId: null,
  pendingPermissions: 0,
  pendingQuestions: 0,
  turnId: null,
}

/** 假会话桥和它的推送入口。 */
export type FakeSessionBridge = {
  bridge: SessionBridge
  /** 把事件包成 session-1 的信封推送；要保存的事件按到达顺序编号。 */
  emit: (event: SessionHostEvent, at?: string) => void
  /** 原样推送一条信封。 */
  push: (envelope: SessionEnvelope) => void
}

/** 创建假会话桥；overrides 替换对应的命令。 */
export function fakeSessionBridge(overrides: Partial<SessionBridge> = {}): FakeSessionBridge {
  let listener: ((envelope: SessionEnvelope) => void) | null = null
  let seq = 0
  const bridge: SessionBridge = {
    start: vi.fn(async () => ({ sessionId: "session-1" })),
    send: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    respondPermission: vi.fn(async () => undefined),
    answerQuestion: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    events: vi.fn(async () => []),
    models: vi.fn(async () => fakeCatalog),
    status: vi.fn(async () => idleStatus),
    subscribe: vi.fn((next: (envelope: SessionEnvelope) => void) => {
      listener = next
      return () => {
        listener = null
      }
    }),
    ...overrides,
  }
  const push = (envelope: SessionEnvelope): void => listener?.(envelope)
  return {
    bridge,
    push,
    emit: (event, at = "2026-11-14T01:00:00.000Z") => {
      const persisted = sessionEventKinds[event.type] === "persisted"
      push({ version: 1, sessionId: "session-1", seq: persisted ? ++seq : null, at, event })
    },
  }
}
