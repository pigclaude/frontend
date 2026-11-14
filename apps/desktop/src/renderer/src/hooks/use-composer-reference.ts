// 把侧栏选中的会话引用交给对应的草稿或会话输入框，等输入框可用后才插入。

import { useEffect, useRef, useState } from "react"
import { requestComposerThreadMention } from "@pigclaude/ui-composer"
import type { Thread } from "@pigclaude/ui-contracts"
import type { SessionReference } from "../../../main/session/session-types"

type QueuedReference = { key: string; reference: SessionReference }

/** 一次投递和完成回调，由目标输入框消费。 */
export type ComposerReferenceRequest = {
  reference: SessionReference
  onInserted: () => void
}

/** 引用进入打开的输入框；没有对应输入框时先打开草稿，按草稿键等待它挂载。 */
export function useComposerReferenceQueue(
  sessionId: string | null,
  draftKey: string,
  resolveDraftKey: (projectId: string) => string | null,
) {
  const [queued, setQueued] = useState<readonly QueuedReference[]>([])
  const next = queued.find((entry) => entry.key === (sessionId ?? draftKey))
  const request: ComposerReferenceRequest | undefined = next && {
    reference: next.reference,
    onInserted: () => setQueued((current) => current.filter((entry) => entry !== next)),
  }
  return {
    request,
    /** 记下侧栏选中的引用；只允许引用其他会话。 */
    reference(thread: Thread) {
      if (thread.id === sessionId) return
      const key = sessionId ?? resolveDraftKey(thread.projectId)
      if (key === null) return
      const reference: SessionReference = {
        kind: "thread",
        threadId: thread.id,
        title: thread.title,
      }
      setQueued((current) => [...current, { key, reference }])
    },
  }
}

/** 所属输入框挂载并启用后插入标签；打开了只读子代理视图时先返回主会话。 */
export function useComposerReference(
  request: ComposerReferenceRequest | undefined,
  ready: boolean,
  showComposer?: () => void,
): void {
  const inserted = useRef<SessionReference | null>(null)
  useEffect(() => {
    if (!request || !ready || inserted.current === request.reference) return
    if (showComposer) {
      showComposer()
      return
    }
    const { reference } = request
    inserted.current = reference
    requestComposerThreadMention(reference.threadId, reference.title)
    request.onInserted()
  }, [request, ready, showComposer])
}
