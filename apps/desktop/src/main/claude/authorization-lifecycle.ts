// 协调账号授权、删除和退出，防止异步授权越过删除或关闭边界。

import { ClaudeAccountError } from "./errors"

type Callback = { cancel: () => void }

/** 一次账号授权的取消、占用和完成状态。 */
export class AuthorizationAttempt {
  readonly accountId: string
  readonly done: Promise<ClaudeAccountError | null>
  readonly #owner: AuthorizationLifecycle
  readonly #overlapped: boolean
  #finishDone: (error: ClaudeAccountError | null) => void = () => undefined
  #callback: Callback | null = null
  readonly #controller = new AbortController()
  #finished = false
  #committing = false

  /** 建立未占用账号的授权尝试。 */
  constructor(owner: AuthorizationLifecycle, accountId: string, overlapped: boolean) {
    this.#owner = owner
    this.accountId = accountId
    this.#overlapped = overlapped
    this.done = new Promise<ClaudeAccountError | null>((resolve) => {
      this.#finishDone = resolve
    })
  }

  /** 与既有同账号尝试重叠的请求不会接管事件。 */
  get mayPublish(): boolean {
    return !this.#overlapped
  }

  /** 提供只读取消信号，供启动器在实际创建进程前检查。 */
  get signal(): AbortSignal {
    return this.#controller.signal
  }

  /** 如果尝试已被取消，则拒绝继续执行副作用。 */
  checkpoint(): void {
    this.signal.throwIfAborted()
  }

  /** 通过前置检查后独占此账号的授权流程。 */
  claim(): void {
    this.checkpoint()
    if (this.#overlapped) throw new ClaudeAccountError("INVALID_INPUT", "该账号已有授权进行中")
    this.#owner.claim(this)
  }

  /** 注册回调以便取消；被取消时由调用方的清理路径关闭回调。 */
  attach(callback: Callback): void {
    this.#callback = callback
    this.checkpoint()
  }

  /** 标记存储提交已开始，此后不再声称可以取消提交。 */
  beginCommit(): void {
    this.checkpoint()
    this.#committing = true
  }

  /** 标记取消并结束回调等待；提交开始后返回明确状态。 */
  async cancel(): Promise<void> {
    if (this.#committing) throw new ClaudeAccountError("INVALID_INPUT", "授权正在保存，请稍候")
    this.#controller.abort(new ClaudeAccountError("AUTHORIZATION_CANCELLED", "授权已取消"))
    this.#callback?.cancel()
  }

  /** 完成清理并释放账号占用；重复调用不产生副作用。 */
  finish(stopError: ClaudeAccountError | null): void {
    if (this.#finished) return
    this.#finished = true
    this.#owner.finish(this)
    this.#finishDone(stopError)
  }
}

/** 管理并发授权，删除前等待同账号的尝试完成，关闭后拒绝新尝试。 */
export class AuthorizationLifecycle {
  readonly #attempts = new Set<AuthorizationAttempt>()
  readonly #claimed = new Map<string, AuthorizationAttempt>()
  readonly #deletions = new Map<string, Promise<void>>()
  #closed = false

  /** 立即登记一次尝试，禁止已关闭或正在删除的账号开始授权。 */
  begin(accountId: string): AuthorizationAttempt {
    if (this.#closed) throw new ClaudeAccountError("AUTHORIZATION_CANCELLED", "授权服务已关闭")
    if (this.#deletions.has(accountId)) {
      throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号正在删除")
    }
    const overlapped = [...this.#attempts].some((attempt) => attempt.accountId === accountId)
    const attempt = new AuthorizationAttempt(this, accountId, overlapped)
    this.#attempts.add(attempt)
    return attempt
  }

  /** 将同账号的有效尝试互斥，不影响未通过前置检查的其他尝试。 */
  claim(attempt: AuthorizationAttempt): void {
    for (const earlier of this.#attempts) {
      if (earlier === attempt) break
      if (earlier.accountId === attempt.accountId) {
        throw new ClaudeAccountError("INVALID_INPUT", "该账号已有授权进行中")
      }
    }
    if (this.#claimed.has(attempt.accountId)) {
      throw new ClaudeAccountError("INVALID_INPUT", "该账号已有授权进行中")
    }
    this.#claimed.set(attempt.accountId, attempt)
  }

  /** 从跟踪集合中移除已完成的尝试。 */
  finish(attempt: AuthorizationAttempt): void {
    this.#attempts.delete(attempt)
    if (this.#claimed.get(attempt.accountId) === attempt) this.#claimed.delete(attempt.accountId)
  }

  /** 取消最近一个有效流程；没有有效流程时取消最早的前置检查。 */
  async cancelCurrent(): Promise<boolean> {
    const active = [...this.#claimed.values()].at(-1) ?? this.#attempts.values().next().value
    if (active === undefined) return false
    await active.cancel()
    const stopError = await active.done
    if (stopError !== null) throw stopError
    return true
  }

  /** 未取得当前事件归属的尝试不得覆盖已有流程的事件。 */
  canEmit(attempt: AuthorizationAttempt): boolean {
    const owner = [...this.#claimed.values()].at(-1) ?? this.#attempts.values().next().value
    return attempt.mayPublish && owner === attempt
  }

  /** 阻止新尝试，取消同账号进行中的尝试并等待清理后删除。 */
  async remove(accountId: string, remove: () => Promise<void>): Promise<void> {
    if (this.#closed) throw new ClaudeAccountError("AUTHORIZATION_CANCELLED", "账号服务已关闭")
    const pending = this.#deletions.get(accountId)
    if (pending !== undefined) return pending
    const attempts = [...this.#attempts].filter((attempt) => attempt.accountId === accountId)
    const deletion = Promise.resolve().then(async () => {
      await Promise.allSettled(attempts.map((attempt) => attempt.cancel()))
      const results = await Promise.all(attempts.map((attempt) => attempt.done))
      const error = results.find((result) => result !== null)
      if (error !== undefined && error !== null) throw error
      await remove()
    })
    this.#deletions.set(accountId, deletion)
    try {
      await deletion
    } finally {
      if (this.#deletions.get(accountId) === deletion) this.#deletions.delete(accountId)
    }
  }

  /** 关闭授权入口并等待已经登记的所有尝试清理完成。 */
  async dispose(): Promise<void> {
    this.#closed = true
    const attempts = [...this.#attempts]
    const deletions = [...this.#deletions.values()]
    await Promise.allSettled(attempts.map((attempt) => attempt.cancel()))
    await Promise.allSettled([...attempts.map((attempt) => attempt.done), ...deletions])
  }
}
