// 负责主进程对工作台未保存文件的了解：页面报告有几个文件没保存；
// 退出、关窗或刷新前可以请页面全部保存或全部放弃，并等它回答。页面不回答或已经关闭时按没保存处理。
import { randomUUID } from "node:crypto"
import type { WorkbenchEvent } from "../../workbench-contract"

/** 报告未保存文件的页面；Electron 的 WebContents 满足这个形状。 */
export type UnsavedOwner = {
  send(channel: string, event: WorkbenchEvent): void
  isDestroyed(): boolean
}

type Request = { owner: UnsavedOwner; finish: (done: boolean) => void }

/** 按页面记下未保存的文件数，并转达保存和放弃的请求。 */
export class UnsavedFiles {
  readonly #counts = new Map<UnsavedOwner, number>()
  readonly #requests = new Map<string, Request>()

  /** 记下页面报告的未保存文件数。 */
  report(owner: UnsavedOwner, count: number): void {
    if (count > 0) this.#counts.set(owner, count)
    else this.#counts.delete(owner)
  }

  /** 某个页面或全部页面的未保存文件数。 */
  count(owner?: UnsavedOwner): number {
    if (owner) return this.#counts.get(owner) ?? 0
    let total = 0
    for (const count of this.#counts.values()) total += count
    return total
  }

  /** 页面刷新、崩溃或关闭后不再计数，正在等它的请求按没完成结束。 */
  forget(owner: UnsavedOwner): void {
    this.#counts.delete(owner)
    for (const [id, request] of this.#requests) {
      if (request.owner === owner) {
        this.#requests.delete(id)
        request.finish(false)
      }
    }
  }

  /** 请页面保存全部文件；全部保存成功时得到 true。 */
  save(owner: UnsavedOwner, timeoutMs = 30_000): Promise<boolean> {
    return this.#request(owner, "save", timeoutMs)
  }

  /** 请页面放弃全部修改；页面回答后不再计数。 */
  async discard(owner: UnsavedOwner, timeoutMs = 5_000): Promise<void> {
    if (await this.#request(owner, "discard", timeoutMs)) this.#counts.delete(owner)
  }

  /** 页面对某次请求的回答；不是发给这个页面的请求不算数。 */
  answer(owner: UnsavedOwner, id: string, done: boolean): void {
    const request = this.#requests.get(id)
    if (!request || request.owner !== owner) return
    this.#requests.delete(id)
    request.finish(done)
  }

  #request(owner: UnsavedOwner, action: "save" | "discard", timeoutMs: number): Promise<boolean> {
    if (owner.isDestroyed()) return Promise.resolve(false)
    const id = randomUUID()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.#requests.delete(id)
        resolve(false)
      }, timeoutMs)
      this.#requests.set(id, {
        owner,
        finish: (done) => {
          clearTimeout(timer)
          resolve(done)
        },
      })
      owner.send("pigclaude:workbench-event", { type: "unsaved-files", id, action })
    })
  }
}
