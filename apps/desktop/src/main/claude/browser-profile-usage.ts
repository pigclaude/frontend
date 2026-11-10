// 在主进程中协调实例使用与配置修改，防止启动过程和编辑过程交错产生两份环境。

/** 多个账号可同时读取同一配置，全部运行资源释放前禁止修改该配置。 */
export class BrowserProfileUsage {
  readonly #owners = new Map<string, Map<string, { count: number; accountId?: string }>>()
  readonly #editing = new Set<string>()

  /** 判断配置是否在运行中或正在被修改。 */
  inUse(id: string): boolean {
    return this.#owners.has(id) || this.#editing.has(id)
  }

  /** 同步预占实例，返回幂等释放；预占后读取配置不会被产品编辑穿插。 */
  acquire(id: string, owner: string, accountId?: string): () => void {
    const existing = this.#owners.get(id)
    if (this.#editing.has(id)) throw new Error("BROWSER_PROFILE_IN_USE: 浏览器实例正在使用")
    const held = existing ?? new Map<string, { count: number; accountId?: string }>()
    const entry = held.get(owner) ?? { count: 0, accountId }
    entry.count++
    held.set(owner, entry)
    this.#owners.set(id, held)
    let released = false
    return () => {
      if (released) return
      released = true
      entry.count--
      if (!entry.count) held.delete(owner)
      if (!held.size && this.#owners.get(id) === held) this.#owners.delete(id)
    }
  }

  /** 判断账号是否仍有授权或会话使用权，避免运行时更换其配置引用。 */
  accountInUse(accountId: string): boolean {
    return [...this.#owners.values()].some((owners) =>
      [...owners.values()].some((entry) => entry.accountId === accountId),
    )
  }

  /** 在没有使用者时执行整次配置修改，所有 await 期间保持编辑权。 */
  async edit<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return this.editMany([id], operation)
  }

  /** 一次性取得所有受影响配置的编辑权，代理改动不能穿过任一活动使用者。 */
  async editMany<T>(ids: readonly string[], operation: () => Promise<T>): Promise<T> {
    if (ids.some((id) => this.inUse(id)))
      throw new Error("BROWSER_PROFILE_IN_USE: 请先结束相关实例的授权或会话")
    for (const id of ids) this.#editing.add(id)
    try {
      return await operation()
    } finally {
      for (const id of ids) this.#editing.delete(id)
    }
  }
}
