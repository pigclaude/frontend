// 负责把 PigClaude 的会话状态映射成 Pigcode 的线程与事件模型，让界面完全由 ui-chat 绘制。
// 时间线事件和流式文字由 session-timeline 从当前会话的信封投影，这里补上线程元数据。
// 只做纯数据转换，不读取桌面桥，也不改变 PigClaude 的会话规则。

import type { RuntimeMode, Thread, ThreadEvent } from "@pigclaude/ui-contracts"
import { sessionRecord } from "./session-event-store"
import type { SessionUiState } from "./session-model"
import { projectTimeline } from "./session-timeline"

/** 生成线程与事件需要的会话级信息。 */
export type ThreadViewInput = {
  state: SessionUiState
  /** 会话 id；草稿用固定值，保证输入框草稿键稳定。 */
  threadId: string
  workspace: string | null
  /** 项目名，取工作区最后一段。 */
  projectName: string
  /** 当前实例（账号）与模型；界面用来显示线程头和模型选择器。 */
  instanceId: string
  modelId: string
  /** 输入框显示的档位；计划开关打开时仍是打开前的那一档。 */
  permissionLevel: RuntimeMode
  planMode: boolean
  /** 会话开始时的时间戳；还没有任何事件时作为线程的创建时间。 */
  startedAt: number
}

/** Pigcode 聊天视图需要的全部数据：线程、时间线事件、进行中那一轮的流式回答和正在输出的思考。 */
export type ThreadView = {
  thread: Thread
  events: ThreadEvent[]
  streamingText: string
  liveReasoning: string
}

/** 把会话状态转成线程和时间线事件；没有活动会话时事件为空。 */
export function threadView(input: ThreadViewInput): ThreadView {
  const { state, threadId, workspace, projectName, instanceId, modelId, startedAt } = input
  const { permissionLevel, planMode } = input
  const timeline = projectTimeline({
    threadId,
    record: sessionRecord(state.events, state.sessionId),
    turns: state.turns,
    answers: state.answers,
  })
  const createdAt = state.turns[0]?.startedAt ?? new Date(startedAt).toISOString()
  const updatedAt = timeline.events.reduce(
    (latest, event) => (event.createdAt > latest ? event.createdAt : latest),
    createdAt,
  )

  return {
    thread: {
      id: threadId,
      projectId: workspace ?? "workspace",
      title: projectName || "会话",
      defaultAgentId: "claude",
      defaultInstanceId: instanceId,
      lastAgentId: "claude",
      lastInstanceId: instanceId,
      lastModelId: modelId === "" ? null : modelId,
      permissionMode: permissionLevel,
      planMode,
      createdAt,
      updatedAt,
      archivedAt: null,
      lastRunId: timeline.lastRunId,
      parentThreadId: null,
    },
    events: timeline.events,
    streamingText: timeline.streamingText,
    liveReasoning: timeline.liveReasoning,
  }
}
