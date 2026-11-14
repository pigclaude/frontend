// 负责一个会话里在途的后台任务：从 SDK 的任务消息读出信号，并记下哪些后台子代理和工作流还在跑。
// 以最近一次后台任务变化消息为准（整表替换）；从没收到过这种消息的旧版 CLI 退回用任务开始和任务通知配对。

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"

/** 适配器从 SDK 任务消息读出的信号；只在主进程内部使用，不发给渲染层。 */
export type BackgroundTaskSignal =
  /** 后台任务变化消息：当前全部在途、要等它跑完的任务，以及回合不等的常驻任务（后台 shell、MCP 监视器）。 */
  | { type: "background-tasks"; taskIds: string[]; ambientTaskIds: string[] }
  /** 任务开始消息里要等它跑完的任务；只在旧版 CLI 上起作用。 */
  | { type: "background-task-started"; taskId: string }
  /** 任务通知消息：任务已结束，不论成功、失败还是被停止。 */
  | { type: "background-task-ended"; taskId: string }

// 后台 shell 和 MCP 监视器可以一直跑（例如开发服务器），回合不等它们。
const awaitedTaskTypes = new Set(["local_agent", "remote_agent", "local_workflow"])

/** 把一条 SDK 消息读成后台任务信号；不是任务开始、任务通知或后台任务变化消息时返回 null。 */
export function readBackgroundTaskSignal(message: SDKMessage): BackgroundTaskSignal | null {
  if (message.type !== "system") return null
  switch (message.subtype) {
    case "background_tasks_changed": {
      const awaited = (task: (typeof message.tasks)[number]): boolean =>
        task.ambient !== true && awaitedTaskTypes.has(task.task_type)
      return {
        type: "background-tasks",
        taskIds: message.tasks.filter(awaited).map((task) => task.task_id),
        ambientTaskIds: message.tasks.filter((task) => !awaited(task)).map((task) => task.task_id),
      }
    }
    case "task_started":
      if (message.ambient === true) return null
      if (message.task_type !== undefined && !awaitedTaskTypes.has(message.task_type)) return null
      return { type: "background-task-started", taskId: message.task_id }
    case "task_notification":
      return { type: "background-task-ended", taskId: message.task_id }
    default:
      return null
  }
}

/** 一个会话的在途后台任务。保证收到过后台任务变化消息后只按最新一份整表判断，不再看配对。 */
export class BackgroundTasks {
  #listed: readonly string[] | null = null
  readonly #paired = new Set<string>()

  /** 记下一条信号。 */
  apply(signal: BackgroundTaskSignal): void {
    switch (signal.type) {
      case "background-tasks":
        this.#listed = [...signal.taskIds]
        break
      case "background-task-started":
        this.#paired.add(signal.taskId)
        break
      case "background-task-ended":
        this.#paired.delete(signal.taskId)
        break
    }
  }

  /** 还在跑、回合要等它们的任务 id。 */
  running(): readonly string[] {
    return this.#listed ?? [...this.#paired]
  }
}
