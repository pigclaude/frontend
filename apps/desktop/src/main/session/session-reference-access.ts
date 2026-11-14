// 负责一个会话的引用授权。只有主进程接受过的用户发送会扩大本会话的直接读取范围。

import type { SessionStore } from "./session-store"
import { composeSessionReferencePrompt, selectSessionReferences } from "./session-reference-prompt"
import type { SessionReference, SessionSendInput } from "./session-types"
import { threadItems, type ReadableThread } from "./thread-read"

/** 给 SDK 的扩展正文与留在 PigClaude 时间线里的结构化引用。 */
export type PreparedSessionReferences = { prompt: string; references: SessionReference[] }

/** 根据适配器是否接收本次发送，提交或放弃此次引用授权。 */
export type FinishReferenceDelivery = (accepted: boolean) => Promise<void>

type Grant = {
  ids: Set<string>
  committing: boolean
  finished: Promise<void>
  release: () => void
}

/** 为一次实际会话启动持有的引用读取作用域。持久索引仍是在后续启动中有效的授权依据。 */
export class SessionReferenceAccess {
  readonly #deliveries = new Set<Grant>()

  /** 将读取固定在 owner 会话，提供同一份存储给参考摘要和 MCP。 */
  constructor(
    private readonly store: SessionStore,
    private readonly owner: string,
  ) {}

  /** 读出明确选中的会话，准备参考说明；这里不产生持久授权。 */
  async prepare(
    input: SessionSendInput,
    redactTitle: (title: string) => string,
  ): Promise<PreparedSessionReferences> {
    const selected = selectSessionReferences(this.owner, input.text, input.references ?? [], (id) =>
      this.store.get(id),
    )
    const sources = await Promise.all(
      selected.map(async ({ reference, index }) => ({
        reference,
        index,
        items: await this.#items(index.id).catch(() => []),
      })),
    )
    const available = sources.filter(({ index }) => this.store.get(index.id) !== null)
    return {
      prompt: composeSessionReferencePrompt(input.text, available),
      references: available.map(({ reference }) => ({
        ...reference,
        title: redactTitle(reference.title),
      })),
    }
  }

  /** 登记生效前的授权，防止 SDK 在收到消息后立即读到尚未确认的请求。 */
  beforeDelivery(references: readonly SessionReference[]): FinishReferenceDelivery | undefined {
    if (references.length === 0) return undefined
    const ids = new Set(references.map(({ threadId }) => threadId))
    let signalFinished!: () => void
    const finished = new Promise<void>((resolve) => {
      signalFinished = resolve
    })
    const grant: Grant = { ids, finished, release: signalFinished, committing: false }
    this.#deliveries.add(grant)
    return async (accepted) => {
      if (!this.#deliveries.has(grant)) return
      try {
        if (accepted) {
          grant.committing = true
          await this.store.recordReferences(this.owner, ids)
        }
      } finally {
        this.#finish(grant)
      }
    }
  }

  /** 立即撤销还没有交给适配器的引用，让等待中的工具调用也能被拒绝。 */
  cancelPendingDeliveries(): void {
    for (const grant of this.#deliveries) {
      if (!grant.committing) this.#finish(grant)
    }
  }

  /** 首先验证调用方范围，再从独立的 PigClaude 时间线读出内容。拒绝时不泄露目标是否存在。 */
  async read(id: string | undefined, active: () => boolean): Promise<ReadableThread | null> {
    if (!active()) return null
    const target = id ?? this.owner
    if (!this.#allows(target)) {
      const pending = [...this.#deliveries].find(({ ids }) => ids.has(target))
      if (pending !== undefined) await pending.finished
    }
    if (!active() || !this.#allows(target) || this.store.get(target) === null) return null
    const items = await this.#items(target)
    const index = this.store.get(target)
    if (!active() || !this.#allows(target) || index === null) return null
    return { index, items }
  }

  #finish(grant: Grant): void {
    this.#deliveries.delete(grant)
    grant.release()
  }

  #allows(target: string): boolean {
    const owner = this.store.get(this.owner)
    return owner !== null && (target === this.owner || owner.referencedSessionIds.includes(target))
  }

  async #items(id: string): Promise<ReadableThread["items"]> {
    // 结果按投影出的条目分页；读完整信封序列以核对工具结果的调用来源。
    const { envelopes } = await this.store.readTimeline(id, { limit: Number.MAX_SAFE_INTEGER })
    return threadItems(envelopes)
  }
}
