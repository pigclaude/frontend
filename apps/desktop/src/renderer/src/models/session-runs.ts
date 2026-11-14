// 负责把一个会话的信封按回合分段：turn-started 到 turn-ended 之间的事件属于主进程开的那一轮；
// 主进程还没开轮时，事件属于这个窗口刚发出、还在等主进程认领的那一轮；
// 一轮结束后迟到的事件归到刚结束的那一轮。
// 会话级的事件（启动、模式、提示、结束）不属于任何一轮。纯函数。

import type { SessionEnvelope } from "../../../main/session/session-envelope"
import type { SessionHostEvent } from "../../../main/session/session-types"
import type { SessionTurn } from "./session-model"

/**
 * 界面上的一轮和属于它的信封，信封按序号排列。closed 表示主进程已经发来这一轮的 turn-ended；
 * 界面先行结束（例如点了停止）的一轮在那之前仍是 false。
 */
export type SessionRun = { turn: SessionTurn; envelopes: SessionEnvelope[]; closed: boolean }

/** 每种事件是否属于某一轮；新增的事件类型不在这里归类就过不了类型检查。 */
const inRun: Readonly<Record<SessionHostEvent["type"], boolean>> = {
  started: false,
  mode: false,
  delta: false,
  message: true,
  "tool-result": true,
  permission: true,
  question: true,
  "question-resolved": true,
  "account-switched": true,
  notice: false,
  context: false,
  result: true,
  "turn-started": false,
  "turn-ended": false,
  "subagent-ended": true,
  error: true,
  ended: false,
}

/** 分段时的位置：正在收事件的一轮、刚结束的一轮，以及下一个可以认领的轮次下标。 */
type Cursor = { current: SessionRun | null; last: SessionRun | null; next: number }

/** 每个界面上的一轮各得一段，顺序和 turns 一致；归不到任何一轮的事件丢掉。 */
export function sessionRuns(
  envelopes: readonly SessionEnvelope[],
  turns: readonly SessionTurn[],
): SessionRun[] {
  const runs: SessionRun[] = turns.map((turn) => ({ turn, envelopes: [], closed: false }))
  const cursor: Cursor = { current: null, last: null, next: 0 }
  for (const envelope of envelopes) {
    const { event } = envelope
    if (event.type === "turn-started") {
      const index = runs.findIndex((run) => run.turn.mainTurnId === event.turnId)
      if (index >= 0) open(cursor, runs, index)
      continue
    }
    if (event.type === "turn-ended") {
      if (cursor.current !== null) {
        cursor.current.closed = true
        cursor.last = cursor.current
      }
      cursor.current = null
      continue
    }
    if (!inRun[event.type]) continue
    if (cursor.current === null) {
      cursor.next = skipUnclaimed(runs, cursor.next)
      const waiting = runs[cursor.next]
      if (waiting !== undefined && waiting.turn.afterSeq < (envelope.seq ?? 0)) {
        open(cursor, runs, cursor.next)
      }
    }
    // 两轮之间的换号只换会话的账号，不补进已经结束的那一轮。
    const target = cursor.current ?? (event.type === "account-switched" ? null : cursor.last)
    target?.envelopes.push(envelope)
  }
  return runs
}

function open(cursor: Cursor, runs: readonly SessionRun[], index: number): void {
  if (cursor.current !== null && cursor.current !== runs[index]) cursor.last = cursor.current
  cursor.current = runs[index] ?? null
  cursor.next = Math.max(cursor.next, index + 1)
}

// 没被主进程认领就在界面上结束、之后又发了一轮的（例如发送失败），不会再收到事件。
// 最后一轮即使已经结束也不跳过：主进程没开轮就发来的事件（例如还没开轮就出错）仍归它。
function skipUnclaimed(runs: readonly SessionRun[], from: number): number {
  let index = from
  while (index < runs.length - 1) {
    const turn = runs[index]?.turn
    if (turn === undefined || turn.mainTurnId !== null || turn.status === "streaming") break
    index += 1
  }
  return index
}
