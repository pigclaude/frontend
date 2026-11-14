// 负责一轮对话里的权限卡片：收到请求时加卡、用户回答后结算、取消或超时时把未回答的卡一起结算，
// 并记下请求和结算的时间。

import type { SessionHostEvent } from "../../../main/session/session-types"
import type { SessionTurn } from "./session-model"

/** 权限卡片的结算状态。 */
export type SessionPermissionStatus = "pending" | "allowed" | "denied" | "timeout"

/** 一张需要回答或已经回答的权限卡片；时间是 ISO UTC。 */
export type SessionPermissionCard = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  suggestions: unknown[]
  blockedPath: string | null
  status: SessionPermissionStatus
  requestedAt: string
  resolvedAt: string | null
}

/** 这些轮次里是否已有这张权限卡片。 */
export function hasPermission(turns: readonly SessionTurn[], requestId: string): boolean {
  return turns.some((turn) => turn.permissions.some((card) => card.requestId === requestId))
}

/** 给一轮加上一张待回答的权限卡片，这一轮进入等待。 */
export function addPermission(
  turn: SessionTurn,
  event: Extract<SessionHostEvent, { type: "permission" }>,
  at: string,
): SessionTurn {
  return {
    ...turn,
    status: "waiting",
    permissions: [
      ...turn.permissions,
      {
        requestId: event.requestId,
        toolName: event.toolName,
        input: event.input,
        suggestions: event.suggestions ?? [],
        blockedPath: event.blockedPath ?? null,
        status: "pending",
        requestedAt: at,
        resolvedAt: null,
      },
    ],
  }
}

/** 结算用户回答的那张卡片；同一轮没有其他待回答的卡时，从等待回到运行。 */
export function answerPermission(
  turns: readonly SessionTurn[],
  requestId: string,
  decision: "allow" | "deny",
  at: string,
): SessionTurn[] {
  return turns.map((turn) => {
    if (!turn.permissions.some((card) => card.requestId === requestId)) return turn
    const permissions = turn.permissions.map((card) =>
      card.requestId === requestId
        ? {
            ...card,
            status: decision === "allow" ? ("allowed" as const) : ("denied" as const),
            resolvedAt: at,
          }
        : card,
    )
    const pending = permissions.some((card) => card.status === "pending")
    return {
      ...turn,
      permissions,
      status: pending || turn.status !== "waiting" ? turn.status : "streaming",
    }
  })
}

/** 把还没回答的卡片一起结算为拒绝或超时。 */
export function settlePendingPermissions(
  cards: SessionPermissionCard[],
  status: "denied" | "timeout",
  at: string,
): SessionPermissionCard[] {
  return cards.map((card) =>
    card.status === "pending" ? { ...card, status, resolvedAt: at } : card,
  )
}
