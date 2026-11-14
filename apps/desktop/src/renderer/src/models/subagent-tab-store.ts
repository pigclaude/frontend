// 负责按会话 id 保存子代理标签的状态：只在渲染层内存里，不写本地存储也不经主进程，会话结束后
// 也保留。可订阅，供 React 的外部存储钩子读取。

import { initialSubagentTabs, type SubagentTabState } from "./subagent-tabs"

/** 各会话的子代理标签状态。保证读不到的会话得到初始状态，每次改动都通知订阅者。 */
export class SubagentTabStore {
  readonly #states = new Map<string, SubagentTabState>()
  readonly #listeners = new Set<() => void>()
  #version = 0

  /** 一个会话当前的标签状态。 */
  read(sessionId: string): SubagentTabState {
    return this.#states.get(sessionId) ?? initialSubagentTabs
  }

  /** 改一个会话的标签状态。 */
  update(sessionId: string, next: (state: SubagentTabState) => SubagentTabState): void {
    this.#states.set(sessionId, next(this.read(sessionId)))
    this.#changed()
  }

  /** 订阅改动；返回取消订阅。 */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 每次改动都会变的版本号，供外部存储钩子判断要不要重绘。 */
  version(): number {
    return this.#version
  }

  #changed(): void {
    this.#version += 1
    for (const listener of this.#listeners) listener()
  }
}
