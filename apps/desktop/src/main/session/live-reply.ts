// 负责一个会话主线程正在输出的回复：记下每段思考第一个增量的时间，思考块落成消息时把思考耗时写进消息；
// 记下还没落成消息的正文，供没有正常结束的一轮补成一条消息。只属于一个会话，时钟由调用方给出。

import type { SessionEvent } from "./session-events"

type MessageEvent = Extract<SessionEvent, { type: "message" }>

/** 主线程正在输出的回复。保证思考耗时只写在主线程的思考消息上，每段思考只按它自己的增量计时。 */
export class LiveReply {
  readonly #now: () => number
  #thinkingSince: number | null = null
  #unfinished = ""

  /** 创建空的回复记录；now 是主进程的时钟。 */
  constructor(now: () => number) {
    this.#now = now
  }

  /** 观察一条适配器事件，返回要发出的事件；只有主线程的思考消息会被换成带思考耗时的新对象。 */
  observe(event: SessionEvent): SessionEvent {
    if (event.type === "delta") {
      if (event.thinking) this.#thinkingSince ??= this.#now()
      else this.#unfinished += event.text
      return event
    }
    if (event.type !== "message" || event.parentToolUseId !== null) return event
    if (event.blocks.some((block) => block.type === "text")) this.#unfinished = ""
    return this.#timeThinking(event)
  }

  /** 取出还没落成消息的正文并清空记录；没有时返回 null。 */
  takeUnfinished(): string | null {
    const text = this.#unfinished
    this.reset()
    return text === "" ? null : text
  }

  /** 清空记录；一轮开始或结束时调用，上一轮没收尾的思考不会算进下一轮。 */
  reset(): void {
    this.#thinkingSince = null
    this.#unfinished = ""
  }

  #timeThinking(event: MessageEvent): MessageEvent {
    const since = this.#thinkingSince
    if (!event.blocks.some((block) => block.type === "thinking")) return event
    this.#thinkingSince = null
    if (since === null) return event
    return { ...event, thinkingMs: Math.max(0, this.#now() - since) }
  }
}
