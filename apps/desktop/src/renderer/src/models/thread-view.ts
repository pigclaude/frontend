// 负责把 PigClaude 的会话状态映射成 Pigcode 的线程与事件模型，让界面完全由 ui-chat 绘制。
// 只做纯数据转换，不读取桌面桥，也不改变 PigClaude 的会话规则。事件时间取会话状态里记下的真实时间。

import type { RuntimeMode, Thread, ThreadEvent } from "@pigclaude/ui-contracts"
import type { SessionTurn, SessionUiState } from "./session-model"

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

/** Pigcode 聊天视图需要的全部数据。 */
export type ThreadView = {
  thread: Thread
  events: ThreadEvent[]
}

/** 往时间线里追加一条事件；at 是事件的 ISO UTC 时间。 */
type PushEvent = (type: ThreadEvent["type"], payload: unknown, at: string) => void

/** 把一轮里的一个工具块转成工具或子代理事件。 */
function pushToolBlock(turn: SessionTurn, toolId: string, push: PushEvent): void {
  const tool = turn.tools.find((item) => item.id === toolId)
  if (tool === undefined) return
  if (tool.name === "Task" || tool.name === "Agent") {
    const input = (tool.input ?? {}) as Record<string, unknown>
    push(
      "subagent.started",
      {
        toolCallId: tool.id,
        name: typeof input.subagent_type === "string" ? input.subagent_type : "子代理",
        ...(typeof input.description === "string" ? { description: input.description } : {}),
        ...(typeof input.prompt === "string" ? { prompt: input.prompt } : {}),
      },
      tool.startedAt,
    )
    if (tool.status !== "running") {
      push(
        "subagent.completed",
        {
          toolCallId: tool.id,
          output: tool.output,
          isError: tool.status === "error",
          status: tool.status === "error" ? "failed" : "completed",
        },
        tool.endedAt ?? tool.startedAt,
      )
    }
    return
  }
  push("tool.started", { toolCallId: tool.id, name: tool.name, input: tool.input }, tool.startedAt)
  if (tool.status !== "running") {
    push(
      "tool.completed",
      {
        toolCallId: tool.id,
        name: tool.name,
        output: tool.output,
        isError: tool.status === "error",
      },
      tool.endedAt ?? tool.startedAt,
    )
  }
}

/** 把一轮的权限卡片转成审批事件；已处理的同时补一条 resolved。 */
function pushPermissions(turn: SessionTurn, push: PushEvent): void {
  for (const card of turn.permissions) {
    const input = card.input
    push(
      "approval.requested",
      {
        id: card.requestId,
        toolName: card.toolName,
        title: card.toolName,
        ...(typeof input.command === "string" ? { command: input.command } : {}),
        ...(card.blockedPath === null ? {} : { description: card.blockedPath }),
        input,
      },
      card.requestedAt,
    )
    if (card.status === "pending") continue
    push(
      "approval.resolved",
      { id: card.requestId, decision: card.status === "allowed" ? "allow-once" : "deny" },
      card.resolvedAt ?? card.requestedAt,
    )
  }
}

/** 一轮结束时的事件类型；还在进行的一轮不补结束事件。 */
function endEvent(turn: SessionTurn): ThreadEvent["type"] | null {
  switch (turn.status) {
    case "done":
      return "run.completed"
    case "error":
      return "run.failed"
    case "cancelled":
      return "run.interrupted"
    default:
      return null
  }
}

/** 把会话状态转成线程和时间线事件；没有活动会话时事件为空。 */
export function threadView(input: ThreadViewInput): ThreadView {
  const { state, threadId, workspace, projectName, instanceId, modelId, startedAt } = input
  const { permissionLevel, planMode } = input
  const events: ThreadEvent[] = []
  const push = (
    type: ThreadEvent["type"],
    runId: string | null,
    payload: unknown,
    createdAt: string,
  ): void => {
    events.push({
      seq: events.length + 1,
      threadId,
      runId,
      type,
      payload,
      schemaVersion: 1,
      createdAt,
    })
  }

  for (const [index, turn] of state.turns.entries()) {
    const runId = `run-${index + 1}`
    const inRun: PushEvent = (type, payload, at) => push(type, runId, payload, at)
    inRun(
      "run.started",
      { agentId: "claude", ...(turn.userText === null ? {} : { text: turn.userText }) },
      turn.startedAt,
    )
    for (const block of turn.blocks) {
      if (block.type === "text") {
        if (block.text !== "") inRun("message.completed", { text: block.text }, block.at)
      } else if (block.type === "thinking") {
        if (block.text !== "") inRun("reasoning.completed", { text: block.text }, block.at)
      } else {
        pushToolBlock(turn, block.id, inRun)
      }
    }
    pushPermissions(turn, inRun)
    for (const item of turn.switches) push("thread.updated", null, { agentId: item.to }, item.at)
    const endedAt = turn.endedAt ?? turn.startedAt
    if (turn.status === "error") {
      const message = turn.errors[turn.errors.length - 1]?.message ?? "会话出错"
      inRun("run.failed", { message }, endedAt)
    }
    const end = endEvent(turn)
    if (end !== null && end !== "run.failed") inRun(end, {}, endedAt)
  }
  const createdAt = state.turns[0]?.startedAt ?? new Date(startedAt).toISOString()
  const updatedAt = events.reduce(
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
      lastRunId: state.turns.length === 0 ? null : `run-${state.turns.length}`,
      parentThreadId: null,
    },
    events,
  }
}
