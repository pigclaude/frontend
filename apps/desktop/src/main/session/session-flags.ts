// 负责一个会话的思考深度和快速模式：先应用变化的 SDK 设置，再凭用户请求所在轮的第一条 init 判断快速模式。

import type { SessionFlagSettings } from "./claude-query"
import type { ReportedFastMode, SessionEffort } from "./session-events"
import type { SessionAdapterPort, SessionSendOptions, SessionStartInput } from "./session-types"

/** 快速模式未生效的提示键，与拷入的聊天语言包对应。 */
export type FastModeNoticeKey =
  | "fast.unavailable"
  | "fast.unavailable.cooldown"
  | "fast.unavailable.extra_usage_disabled"
  | "fast.unavailable.free"
  | "fast.unavailable.model_not_allowed"

type FastTurn = {
  id: string
  waiting: boolean
  opened: boolean
  notice: FastModeNoticeKey | null
}

/** 一个会话的 flag 状态。按顺序向 SDK 提交变化，并且每条用户消息最多根据一次 init 生成快速模式提示。 */
export class SessionTurnFlags {
  readonly #adapter: Pick<SessionAdapterPort, "applyFlagSettings">
  #effort: SessionEffort | null
  #fast: boolean
  #applying = Promise.resolve()
  #turn: FastTurn | null = null

  /** 用新建会话已经交给 SDK 的初始设置初始化。 */
  constructor(
    adapter: Pick<SessionAdapterPort, "applyFlagSettings">,
    input: Pick<SessionStartInput, "effort" | "fast">,
  ) {
    this.#adapter = adapter
    this.#effort = input.effort ?? null
    this.#fast = input.fast ?? false
  }

  /** 比较当前设置并等待 SDK 确认；消息已经取消时跳过，失败时保持原先已确认的值。 */
  apply(input: SessionSendOptions, canSend: () => boolean): Promise<void> {
    const applying = this.#applying.then(async () => {
      if (!canSend()) return
      const { effort, fast } = input
      const settings: SessionFlagSettings = {}
      if (effort !== undefined && effort !== this.#effort) settings.effortLevel = effort
      if (fast !== undefined && fast !== this.#fast) settings.fastMode = fast
      if (settings.effortLevel === undefined && settings.fastMode === undefined) return
      await this.#adapter.applyFlagSettings(settings)
      this.#effort = settings.effortLevel === undefined ? this.#effort : settings.effortLevel
      this.#fast = settings.fastMode ?? this.#fast
    })
    this.#applying = applying.catch(() => undefined)
    return applying
  }

  /** 即将把消息写给 SDK；仅在请求快速模式时等这轮的第一条 init。 */
  expectInit(turnId: string): void {
    this.#turn = this.#fast ? { id: turnId, waiting: true, opened: false, notice: null } : null
  }

  /** 回合已开；若 SDK 的 init 先到，此时返回先前暂存的提示。 */
  opened(turnId: string): FastModeNoticeKey | null {
    const turn = this.#turn
    if (turn?.id !== turnId) return null
    turn.opened = true
    const notice = turn.notice
    turn.notice = null
    return notice
  }

  /** 只检查第一条 init；回合尚未开则等 turn-started 发出后再交付提示。 */
  observeInit(mode: ReportedFastMode | undefined): FastModeNoticeKey | null {
    const turn = this.#turn
    if (turn === null || !turn.waiting) return null
    turn.waiting = false
    const notice = unavailable(mode)
    if (turn.opened) return notice
    turn.notice = notice
    return null
  }

  /** 停止等待本轮的 init；防止中断、结束或失败后的通知归到别的回合。 */
  ended(turnId: string): void {
    if (this.#turn?.id === turnId) this.#turn = null
  }
}

function unavailable(mode: ReportedFastMode | undefined): FastModeNoticeKey | null {
  if (mode?.state === "cooldown") return "fast.unavailable.cooldown"
  if (mode?.state !== "off") return null
  switch (mode.reason) {
    case "extra_usage_disabled":
    case "free":
    case "model_not_allowed":
      return `fast.unavailable.${mode.reason}`
    default:
      return "fast.unavailable"
  }
}
