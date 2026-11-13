// 负责把 PigClaude 的会话状态映射成 Pigcode 的线程与事件模型，让界面完全由 ui-chat 绘制。
// 只做纯数据转换，不读取桌面桥，也不改变 PigClaude 的会话规则。

import type { Thread, ThreadEvent } from "@pigclaude/ui-contracts"
import type { SessionTurn, SessionUiState } from "./session-model"
import { composerPermissionMode } from "./composer-config"

/** 生成线程与事件需要的会话级信息。 */
export type ThreadViewInput = {
  state: SessionUiState
  /** 会话 id；草稿用固定值，保证输入框草稿键稳定。 */
  threadId: string
  workspace: string | null
  /** 项目名，取工作区最后一段。 */
  projectName: string
  /** 当前实例（账号）与模型；界面用来显示线程头与环境抽屉。 */
  instanceId: string
  modelId: string
  /** 会话开始时的时间戳，事件时间按它递增，避免每帧都变。 */
  startedAt: number
}

/** Pigcode 聊天视图需要的全部数据。 */
export type ThreadView = {
  thread: Thread
  events: ThreadEvent[]
}

/** 把一轮里的一个工具块转成工具或子代理事件。 */
function pushToolBlock(
  turn: SessionTurn,
  toolId: string,
  push: (type: ThreadEvent["type"], payload: unknown) => void,
): void {
  const tool = turn.tools.find((item) => item.id === toolId)
  if (tool === undefined) return
  if (tool.name === "Task" || tool.name === "Agent") {
    const input = (tool.input ?? {}) as Record<string, unknown>
    push("subagent.started", {
      toolCallId: tool.id,
      name: typeof input.subagent_type === "string" ? input.subagent_type : "子代理",
      ...(typeof input.description === "string" ? { description: input.description } : {}),
      ...(typeof input.prompt === "string" ? { prompt: input.prompt } : {}),
    })
    if (tool.status !== "running") {
      push("subagent.completed", {
        toolCallId: tool.id,
        output: tool.output,
        isError: tool.status === "error",
        status: tool.status === "error" ? "failed" : "completed",
      })
    }
    return
  }
  push("tool.started", { toolCallId: tool.id, name: tool.name, input: tool.input })
  if (tool.status !== "running") {
    push("tool.completed", {
      toolCallId: tool.id,
      name: tool.name,
      output: tool.output,
      isError: tool.status === "error",
    })
  }
}

/** 把一轮的权限卡片转成审批事件；已处理的同时补一条 resolved。 */
function pushPermissions(
  turn: SessionTurn,
  push: (type: ThreadEvent["type"], payload: unknown) => void,
): void {
  for (const card of turn.permissions) {
    const input = card.input
    push("approval.requested", {
      id: card.requestId,
      toolName: card.toolName,
      title: card.toolName,
      ...(typeof input.command === "string" ? { command: input.command } : {}),
      ...(card.blockedPath === null ? {} : { description: card.blockedPath }),
      input,
    })
    if (card.status === "pending") continue
    push("approval.resolved", {
      id: card.requestId,
      decision: card.status === "allowed" ? "allow-once" : "deny",
    })
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
  const events: ThreadEvent[] = []
  let seq = 0
  const iso = (step: number): string => new Date(startedAt + step * 1_000).toISOString()
  const push = (type: ThreadEvent["type"], runId: string | null, payload: unknown): void => {
    seq += 1
    events.push({
      seq,
      threadId,
      runId,
      type,
      payload,
      schemaVersion: 1,
      createdAt: iso(seq),
    })
  }

  for (const [index, turn] of state.turns.entries()) {
    const runId = `run-${index + 1}`
    push("run.started", runId, {
      agentId: "claude",
      ...(turn.userText === null ? {} : { text: turn.userText }),
    })
    for (const block of turn.blocks) {
      if (block.type === "text") {
        if (block.text !== "") push("message.completed", runId, { text: block.text })
      } else if (block.type === "thinking") {
        if (block.text !== "") push("reasoning.completed", runId, { text: block.text })
      } else {
        pushToolBlock(turn, block.id, (type, payload) => push(type, runId, payload))
      }
    }
    pushPermissions(turn, (type, payload) => push(type, runId, payload))
    for (const item of turn.switches) push("thread.updated", null, { agentId: item.to })
    if (turn.status === "error") {
      const message = turn.errors[turn.errors.length - 1]?.message ?? "会话出错"
      push("run.failed", runId, { message })
    }
    const end = endEvent(turn)
    if (end !== null && end !== "run.failed") push(end, runId, {})
  }

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
      permissionMode: composerPermissionMode(state.permissionMode),
      createdAt: iso(0),
      updatedAt: iso(seq),
      archivedAt: null,
      lastRunId: state.turns.length === 0 ? null : `run-${state.turns.length}`,
      parentThreadId: null,
    },
    events,
  }
}
