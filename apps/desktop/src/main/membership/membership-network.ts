// 管理会员核验失败的连续计时，以及系统唤醒后再次访问服务端的时机。
import { PigclaudeApiError } from "../api/oauth-client"

const graceMs = 10 * 60_000
const wakeRetryMs = 1_000
type EndState = "error" | "expired"
type WakeRetry = {
  isOnline: () => boolean
  onOnline: (() => void) | undefined
  timer?: ReturnType<typeof setTimeout>
}

/** 识别 API 连接失败、请求超时和上游暂时不可用，其他错误按原门禁处理。 */
export function isMembershipNetworkFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && error.code === "SERVER_UNAVAILABLE") return true
  return (
    error instanceof PigclaudeApiError &&
    error.status !== null &&
    (error.status === 408 || (error.status >= 500 && error.status < 600))
  )
}

/** 一次持续的网络故障只占用一个宽限计时；唤醒后的连接等待与该计时独立。 */
export class MembershipNetwork {
  #grace: {
    until: number
    state: EndState
    timer: ReturnType<typeof setTimeout>
    expire: (state: EndState) => void
  } | null = null
  #wake: WakeRetry | null = null

  /** 使用门禁的同一个时钟判断本机截止时间。 */
  constructor(private readonly now: () => number) {}

  /** 开始或沿用当前宽限。已核验的权益到期时间更早时，按到期时间停止。 */
  retainUntil(
    membershipValidUntil: string | null,
    expire: (state: EndState) => void,
  ): "network_grace" | EndState {
    const now = this.now()
    const membershipUntil = membershipValidUntil ? Date.parse(membershipValidUntil) : Infinity
    const state = membershipUntil <= now + graceMs ? "expired" : "error"
    const until = state === "expired" ? membershipUntil : now + graceMs
    if (this.#grace !== null) return this.#grace.until > now ? "network_grace" : this.#grace.state
    if (until <= now) return state
    const timer = setTimeout(() => expire(state), until - now)
    timer.unref()
    this.#grace = { until, state, timer, expire }
    return "network_grace"
  }

  /** 唤醒后即使定时器尚未执行，也按实际截止时间结束已经超时的宽限。 */
  expireOverdue(): void {
    const grace = this.#grace
    if (!grace || this.now() < grace.until) return
    this.clearGrace()
    grace.expire(grace.state)
  }

  /** 成功核验、身份失效或退出后清除上一段连续网络失败。 */
  clearGrace(): void {
    if (this.#grace !== null) clearTimeout(this.#grace.timer)
    this.#grace = null
  }

  /** 唤醒后等系统报告已联网。首次观察到联网时告知调用者。 */
  afterWake(isOnline: () => boolean, check: () => void, onOnline?: () => void): void {
    this.clearWake()
    const wake: WakeRetry = { isOnline, onOnline }
    this.#wake = wake
    const poll = () => {
      if (this.#wake !== wake) return
      if (!this.waitingForNetwork()) {
        check()
        return
      }
      wake.timer = setTimeout(poll, wakeRetryMs)
      wake.timer.unref()
    }
    if (this.waitingForNetwork()) {
      wake.timer = setTimeout(poll, wakeRetryMs)
      wake.timer.unref()
    }
    check()
  }

  /** 唤醒后仍离线时阻止所有入口提前访问会员服务，也不允许沿用旧权限。 */
  waitingForNetwork(): boolean {
    const wake = this.#wake
    if (wake === null) return false
    if (!wake.isOnline()) return true
    this.clearWake()
    try {
      wake.onOnline?.()
    } catch {
      // 调度回调出错时，会员核验仍可继续。
    }
    return false
  }

  /** 停止唤醒重试，供关停清理。 */
  clearWake(): void {
    if (this.#wake?.timer !== undefined) clearTimeout(this.#wake.timer)
    this.#wake = null
  }
}
