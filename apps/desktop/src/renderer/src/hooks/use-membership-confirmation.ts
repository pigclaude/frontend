// 负责浏览器授权完成后向主进程要一次会员结果，会员不可用时让登录页回到空闲态。
import { useCallback, useEffect, useRef, useState } from "react"
import type { MembershipView } from "@pigclaude/contracts/membership"

/** 会员确认需要的页面状态和回调。 */
export type MembershipConfirmationOptions = {
  /** 登录页当前是否停在「正在确认会员…」。 */
  confirming: boolean
  /** 页面当前采用的会员快照。 */
  membership: MembershipView
  /** 主进程返回的新快照，交给页面按版本合并。 */
  onInspected: (view: MembershipView) => void
  /** 会员没有生效或检查失败，登录页应回到空闲态显示门禁提示。 */
  onInactive: () => void
}

/**
 * 返回稳定的 confirm()。保证只有 confirm 之后拿到的会员结果才会结束确认：
 * 会员有效时不做任何事，由页面门禁直接进入下一屏；仍在连接时继续等；其余状态调用 onInactive。
 */
export function useMembershipConfirmation({
  confirming,
  membership,
  onInspected,
  onInactive,
}: MembershipConfirmationOptions): () => void {
  const [settledRevision, setSettledRevision] = useState<number | null>(null)
  const generation = useRef(0)
  const callbacks = useRef({ onInspected, onInactive })

  useEffect(() => {
    callbacks.current = { onInspected, onInactive }
  })

  const confirm = useCallback(() => {
    const current = ++generation.current
    setSettledRevision(null)
    const inspect = window.pigclaude?.membership?.inspect
    if (!inspect) {
      callbacks.current.onInactive()
      return
    }
    inspect().then(
      (view) => {
        if (current !== generation.current) return
        if (view) callbacks.current.onInspected(view)
        setSettledRevision(view?.revision ?? 0)
      },
      () => {
        if (current === generation.current) callbacks.current.onInactive()
      },
    )
  }, [])

  useEffect(() => {
    if (!confirming || settledRevision === null) return
    if (membership.revision < settledRevision) return
    if (membership.state === "active" || membership.state === "connecting") return
    setSettledRevision(null)
    callbacks.current.onInactive()
  }, [confirming, membership, settledRevision])

  return confirm
}
