// 负责把 Claude 的 AskUserQuestion 变成提问卡：发出提问事件，等用户回答后按 allow 加回答写回工具输入；
// 空答案、取消、停止、会员失效和超时都按拒绝返回。请求放在会话共用的待答队列里。

import { randomUUID } from "node:crypto"
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import { answerRecord, type SessionQuestion } from "./ask-user-question"
import type { PendingAnswers, PendingOutcome } from "./pending-answers"

/** 写给模型、不显示在界面上的拒绝说明，所以固定用英文。 */
const unansweredMessage = "The user did not answer these questions."

/** 发给 renderer 的提问；只含问题、选项和请求 id。 */
export type QuestionRequestEvent = {
  type: "question"
  requestId: string
  questions: SessionQuestion[]
}

/** 一次提问结束：answers 与问题顺序一致；没有回答（取消、空答案、停止、超时）时为空数组。 */
export type QuestionResolvedEvent = {
  type: "question-resolved"
  requestId: string
  answers: string[]
}

/** renderer 的回答：每个问题一条答案，顺序和问题一致；多选已用逗号连接。 */
export type QuestionAnswer = { requestId: string; answers: string[] }

/** 提问代理依赖；emit 把提问和结束事件送到 renderer，onTimeout 负责结束当前 turn。 */
export type QuestionBrokerOptions = {
  queue: PendingAnswers
  emit: (event: QuestionRequestEvent | QuestionResolvedEvent) => void
  onTimeout?: () => void
  newRequestId?: () => string
}

/** 一次还没结束的提问；answers 是用户给的、写回 Claude 之前整理过的答案。 */
type Asked = {
  questions: SessionQuestion[]
  input: Record<string, unknown>
  answers: string[]
}

/** 提问代理。保证每次提问只结算一次，并且恰好发出一条对应的结束事件。 */
export class QuestionBroker {
  readonly #options: QuestionBrokerOptions
  readonly #newRequestId: () => string
  readonly #asked = new Map<string, Asked>()

  /** 创建提问代理；请求 id 是全局唯一的 UUID。 */
  constructor(options: QuestionBrokerOptions) {
    this.#options = options
    this.#newRequestId = options.newRequestId ?? (() => randomUUID())
  }

  /** 当前还没回答的提问数。 */
  get pendingCount(): number {
    return this.#options.queue.count("question")
  }

  /** 发出一次提问并等用户回答；signal 已中止时直接拒绝且不发事件。 */
  ask(
    questions: SessionQuestion[],
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    if (signal.aborted) return Promise.resolve({ behavior: "deny", message: unansweredMessage })
    const requestId = this.#newRequestId()
    return new Promise<PermissionResult>((resolve) => {
      this.#asked.set(requestId, { questions, input, answers: [] })
      this.#options.queue.add(requestId, {
        kind: "question",
        signal,
        settle: (outcome) => resolve(this.#finish(requestId, outcome)),
        ...(this.#options.onTimeout === undefined ? {} : { onTimeout: this.#options.onTimeout }),
      })
      this.#emitSafely({ type: "question", requestId, questions })
    })
  }

  /**
   * 写回一次回答；未知或已结算的请求返回 false。答案条数和问题数不一致时抛 INVALID_SESSION_INPUT；
   * 全部是空白时按拒绝返回。
   */
  answer(answer: QuestionAnswer): boolean {
    const asked = this.#asked.get(answer.requestId)
    if (asked === undefined) return false
    if (answer.answers.length !== asked.questions.length) {
      throw new Error("INVALID_SESSION_INPUT")
    }
    const answers = answerRecord(asked.questions, answer.answers)
    if (Object.keys(answers).length === 0) {
      return this.#options.queue.answer(answer.requestId, "question", {
        behavior: "deny",
        message: unansweredMessage,
      })
    }
    asked.answers = asked.questions.map((question) => answers[question.question] ?? "")
    return this.#options.queue.answer(answer.requestId, "question", {
      behavior: "allow",
      updatedInput: { ...asked.input, answers },
    })
  }

  #finish(requestId: string, outcome: PendingOutcome): PermissionResult {
    const asked = this.#asked.get(requestId)
    this.#asked.delete(requestId)
    const result: PermissionResult =
      outcome.type === "answered"
        ? outcome.result
        : { behavior: "deny", message: unansweredMessage }
    const answers = result.behavior === "allow" ? (asked?.answers ?? []) : []
    this.#emitSafely({ type: "question-resolved", requestId, answers })
    return result
  }

  #emitSafely(event: QuestionRequestEvent | QuestionResolvedEvent): void {
    try {
      this.#options.emit(event)
    } catch {
      // 单个事件订阅者失败不能挂起 SDK 的 canUseTool。
    }
  }
}
