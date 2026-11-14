// 负责验证会话状态到 Pigcode 线程模型的纯函数映射：线程元数据、事件顺序、工具/权限/换号事件和各结束状态。

import { describe, expect, it } from "vitest"
import type { SessionTurn, SessionUiState } from "./session-model"
import { threadView, type ThreadViewInput } from "./thread-view"

/** 构造一轮会话；默认是一轮还在进行、没有内容的对话。 */
function turn(overrides: Partial<SessionTurn> = {}): SessionTurn {
  return {
    id: "turn-1",
    userText: null,
    blocks: [],
    tools: [],
    permissions: [],
    switches: [],
    errors: [],
    result: null,
    status: "streaming",
    seenMessageIds: [],
    ...overrides,
  }
}

/** 构造会话状态；默认没有轮次。 */
function state(overrides: Partial<SessionUiState> = {}): SessionUiState {
  return {
    sessionId: "session-1",
    started: true,
    ended: false,
    endedReason: null,
    model: "sonnet",
    permissionMode: "default",
    accountId: "account-1",
    activeTurnId: null,
    turns: [],
    error: null,
    notice: null,
    ...overrides,
  }
}

/** 构造映射输入；测试只覆盖关心的字段。 */
function input(overrides: Partial<ThreadViewInput> = {}): ThreadViewInput {
  return {
    state: state(),
    threadId: "thread-1",
    workspace: "/work/demo",
    projectName: "demo",
    instanceId: "account-1",
    modelId: "sonnet",
    permissionLevel: "approval-required",
    planMode: false,
    startedAt: Date.UTC(2026, 10, 13, 0, 0, 0),
    ...overrides,
  }
}

describe("threadView", () => {
  it("空会话只产出线程元数据，没有事件", () => {
    const view = threadView(input())
    expect(view.events).toEqual([])
    expect(view.thread).toMatchObject({
      id: "thread-1",
      projectId: "/work/demo",
      title: "demo",
      defaultInstanceId: "account-1",
      lastInstanceId: "account-1",
      lastModelId: "sonnet",
      permissionMode: "approval-required",
      planMode: false,
      lastRunId: null,
      parentThreadId: null,
      archivedAt: null,
    })
    expect(view.thread.createdAt).toBe(new Date(Date.UTC(2026, 10, 13, 0, 0, 0)).toISOString())
    expect(view.thread.updatedAt).toBe(view.thread.createdAt)
  })

  it("按块顺序映射一轮对话并递增序号", () => {
    const view = threadView(
      input({
        state: state({
          turns: [
            turn({
              userText: "你好",
              blocks: [
                { type: "thinking", text: "想一想" },
                { type: "text", text: "答" },
                { type: "tool", id: "tool-1" },
              ],
              tools: [
                {
                  id: "tool-1",
                  name: "Bash",
                  input: { command: "ls" },
                  status: "done",
                  output: "ok",
                },
              ],
              status: "done",
            }),
          ],
        }),
      }),
    )

    expect(view.events.map((event) => event.type)).toEqual([
      "run.started",
      "reasoning.completed",
      "message.completed",
      "tool.started",
      "tool.completed",
      "run.completed",
    ])
    expect(view.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(view.events.every((event) => event.threadId === "thread-1")).toBe(true)
    expect(view.events[0]?.runId).toBe("run-1")
    expect(view.events[0]?.payload).toMatchObject({ agentId: "claude", text: "你好" })
    expect(view.events[3]?.payload).toMatchObject({
      toolCallId: "tool-1",
      name: "Bash",
      input: { command: "ls" },
    })
    expect(view.events[4]?.payload).toMatchObject({
      toolCallId: "tool-1",
      output: "ok",
      isError: false,
    })
    expect(view.events[1]?.createdAt).toBe(new Date(Date.UTC(2026, 10, 13, 0, 0, 2)).toISOString())
    expect(view.thread.lastRunId).toBe("run-1")
    expect(view.thread.updatedAt).toBe(new Date(Date.UTC(2026, 10, 13, 0, 0, 6)).toISOString())
  })

  it("跳过空文本块，不产出空消息", () => {
    const view = threadView(
      input({
        state: state({
          turns: [
            turn({
              blocks: [
                { type: "text", text: "" },
                { type: "thinking", text: "" },
              ],
            }),
          ],
        }),
      }),
    )
    expect(view.events.map((event) => event.type)).toEqual(["run.started"])
  })

  it("进行中的一轮不补结束事件", () => {
    const view = threadView(input({ state: state({ turns: [turn({ status: "waiting" })] }) }))
    expect(view.events.map((event) => event.type)).toEqual(["run.started"])
  })

  it("取消的一轮以 run.interrupted 结束", () => {
    const view = threadView(input({ state: state({ turns: [turn({ status: "cancelled" })] }) }))
    expect(view.events.map((event) => event.type)).toEqual(["run.started", "run.interrupted"])
  })

  it("出错的一轮只发一条 run.failed，并带上最后一条错误文案", () => {
    const view = threadView(
      input({
        state: state({
          turns: [
            turn({
              status: "error",
              errors: [
                { code: "A", message: "先出现的错误", warning: false },
                { code: "B", message: "最后的错误", warning: false },
              ],
            }),
          ],
        }),
      }),
    )
    expect(view.events.map((event) => event.type)).toEqual(["run.started", "run.failed"])
    expect(view.events[1]?.payload).toMatchObject({ message: "最后的错误" })
  })

  it("权限卡片映射请求与处理结果", () => {
    const view = threadView(
      input({
        state: state({
          turns: [
            turn({
              permissions: [
                {
                  requestId: "req-1",
                  toolName: "Bash",
                  input: { command: "rm -rf build" },
                  suggestions: [],
                  blockedPath: "/work/demo/build",
                  status: "allowed",
                },
                {
                  requestId: "req-2",
                  toolName: "Write",
                  input: { file_path: "/work/demo/a.ts" },
                  suggestions: [],
                  blockedPath: null,
                  status: "denied",
                },
                {
                  requestId: "req-3",
                  toolName: "Read",
                  input: { file_path: "/work/demo/b.ts" },
                  suggestions: [],
                  blockedPath: null,
                  status: "pending",
                },
              ],
            }),
          ],
        }),
      }),
    )

    const approvals = view.events.filter((event) => event.type.startsWith("approval."))
    expect(approvals.map((event) => event.type)).toEqual([
      "approval.requested",
      "approval.resolved",
      "approval.requested",
      "approval.resolved",
      "approval.requested",
    ])
    expect(approvals[0]?.payload).toMatchObject({
      id: "req-1",
      toolName: "Bash",
      title: "Bash",
      command: "rm -rf build",
      description: "/work/demo/build",
    })
    expect(approvals[1]?.payload).toMatchObject({ id: "req-1", decision: "allow-once" })
    expect(approvals[3]?.payload).toMatchObject({ id: "req-2", decision: "deny" })
    expect(approvals[4]?.payload).not.toHaveProperty("decision")
  })

  it("Task 与 Agent 工具映射成子代理事件", () => {
    const view = threadView(
      input({
        state: state({
          turns: [
            turn({
              blocks: [
                { type: "tool", id: "task-1" },
                { type: "tool", id: "task-2" },
              ],
              tools: [
                {
                  id: "task-1",
                  name: "Task",
                  input: { subagent_type: "explore", description: "找文件", prompt: "搜索" },
                  status: "running",
                  output: null,
                },
                {
                  id: "task-2",
                  name: "Agent",
                  input: {},
                  status: "error",
                  output: "失败",
                },
              ],
            }),
          ],
        }),
      }),
    )

    expect(view.events.map((event) => event.type)).toEqual([
      "run.started",
      "subagent.started",
      "subagent.started",
      "subagent.completed",
    ])
    expect(view.events[1]?.payload).toMatchObject({
      toolCallId: "task-1",
      name: "explore",
      description: "找文件",
      prompt: "搜索",
    })
    expect(view.events[2]?.payload).toMatchObject({ toolCallId: "task-2", name: "子代理" })
    expect(view.events[3]?.payload).toMatchObject({
      toolCallId: "task-2",
      output: "失败",
      isError: true,
      status: "failed",
    })
  })

  it("换号事件不带 runId，账号目标写在 payload 里", () => {
    const view = threadView(
      input({
        state: state({
          turns: [
            turn({
              switches: [{ from: "a", to: "b", reason: "switch" }],
            }),
          ],
        }),
      }),
    )
    const updated = view.events.find((event) => event.type === "thread.updated")
    expect(updated?.runId).toBeNull()
    expect(updated?.payload).toMatchObject({ agentId: "b" })
  })

  it("多轮的 runId 递增，最后一条 run 写到线程上", () => {
    const view = threadView(
      input({
        state: state({
          turns: [turn({ status: "done" }), turn({ id: "turn-2", status: "done" })],
        }),
      }),
    )
    const runIds = [...new Set(view.events.map((event) => event.runId))].filter((id) => id !== null)
    expect(runIds).toEqual(["run-1", "run-2"])
    expect(view.thread.lastRunId).toBe("run-2")
  })

  it("没有工作区、项目名或模型时使用稳定回退值", () => {
    const view = threadView(input({ workspace: null, projectName: "", modelId: "" }))
    expect(view.thread.projectId).toBe("workspace")
    expect(view.thread.title).toBe("会话")
    expect(view.thread.lastModelId).toBeNull()
  })

  it("线程带上输入框的档位和独立的计划开关", () => {
    expect(
      threadView(input({ permissionLevel: "full-access", planMode: true })).thread,
    ).toMatchObject({ permissionMode: "full-access", planMode: true })
    expect(
      threadView(input({ permissionLevel: "auto-accept-edits", planMode: false })).thread,
    ).toMatchObject({ permissionMode: "auto-accept-edits", planMode: false })
  })
})
