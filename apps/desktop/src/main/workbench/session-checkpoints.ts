// 把会话回合的前后边界记录为本地 Git 检查点，并记下它属于哪个会话的哪一轮。
import type { WebContents } from "electron"
import type { WorkbenchEvent } from "../../workbench-contract"
import { captureWorkbenchCheckpoint, type CheckpointOrigin } from "./git-checkpoints"

const pending = new Map<string, Promise<void>>()

/** 在用户消息发送前和结果发布前依次记录快照；普通目录或 Git 不可用时保留会话能力。 */
export function captureSessionCheckpoint(
  owner: WebContents,
  workspace: string,
  phase: "baseline" | "final",
  origin: CheckpointOrigin,
): Promise<void> {
  const task = (pending.get(workspace) ?? Promise.resolve())
    .then(() => captureWorkbenchCheckpoint(workspace, phase, origin))
    .then(
      () => {
        const event: WorkbenchEvent = { type: "checkpoints-changed", id: workspace }
        if (!owner.isDestroyed()) owner.send("pigclaude:workbench-event", event)
      },
      () => undefined,
    )
  pending.set(workspace, task)
  return task
    .catch(() => undefined)
    .finally(() => {
      if (pending.get(workspace) === task) pending.delete(workspace)
    })
}
