// 负责把系统私有协议事件短暂、有界地交给现有授权服务，不保存或重建授权事务。

/** 桌面私有协议的固定回调基地址；会话和参数仍由授权服务校验。 */
export const privateAuthorizationRedirectUri = "pigclaude://authorize/callback"

type OpenUrlListener = (event: { preventDefault(): void }, url: string) => void
type SecondInstanceListener = (event: unknown, commandLine: string[]) => void

/** 仅使用两类系统事件及其卸载能力，不依赖窗口或系统注册操作。 */
export type CallbackEventSource = {
  /** 订阅系统私有协议 URL。 */
  on(event: "open-url", listener: OpenUrlListener): unknown
  /** 订阅已有主实例收到的命令行。 */
  on(event: "second-instance", listener: SecondInstanceListener): unknown
  /** 卸载本接收器的 URL 监听，不影响其他事件。 */
  removeListener(event: "open-url", listener: OpenUrlListener): unknown
  /** 卸载本接收器的已有实例监听。 */
  removeListener(event: "second-instance", listener: SecondInstanceListener): unknown
}

/** 接收器只调用既有回调处理与窗口唤醒端口，不另做凭据兑换。 */
export type CallbackReceiverOptions = {
  app: CallbackEventSource
  onCallback: (url: string) => Promise<unknown>
  onSecondInstance: () => void
}

/** 控制收件生命周期，关闭后不能重新放行。 */
export type AuthorizationCallbackReceiver = {
  /** 从命令行选择首个合格原始回调并送入同一队列，不保存整组参数。 */
  receiveArguments(commandLine: readonly string[]): void
  /** 仅在整个初始化完成后放行，并交付仍未过期的缓冲输入。 */
  ready(): void
  /** 仅清理尚未交付的输入，保留以后重新授权的收件能力。 */
  clearPending(): void
  /** 同步关闭、清空缓冲并卸载事件，不取消已经开始的授权提交。 */
  dispose(): void
}

type PendingCallback = { url: string; expiresAt: number }

const maxWaitingCallbacks = 32
const maxUrlBytes = 8_192
const queuedTtlMs = 60_000

/** 创建并绑定有界收件器：最多 32 项等待及 1 项正在交付，满时拒绝新输入。 */
export function createAuthorizationCallbackReceiver(
  options: CallbackReceiverOptions,
): AuthorizationCallbackReceiver {
  let phase: "waiting" | "ready" | "closed" = "waiting"
  let pending: PendingCallback[] = []
  let delivering = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const openUrl: OpenUrlListener = (event, url) => {
    if (phase === "closed") return
    event.preventDefault()
    receive(url)
  }
  const secondInstance: SecondInstanceListener = (_event, commandLine) => {
    if (phase === "closed") return
    receiveArguments(commandLine)
    options.onSecondInstance()
  }
  options.app.on("open-url", openUrl)
  options.app.on("second-instance", secondInstance)

  function receiveArguments(commandLine: readonly string[]): void {
    if (phase === "closed") return
    // 只选第一个符合原始基地址及字节上限的候选，不假定 URL 位于末尾。
    const callback = commandLine.find(isCandidate)
    if (callback !== undefined) receive(callback)
  }

  function receive(url: string): void {
    if (phase === "closed" || !isCandidate(url)) return
    pruneExpired()
    if (pending.length >= maxWaitingCallbacks) return
    // 单调时钟避免系统校时让短暂缓冲被意外延长。
    pending.push({ url, expiresAt: performance.now() + queuedTtlMs })
    scheduleExpiry()
    void drain()
  }

  function pruneExpired(): void {
    const now = performance.now()
    pending = pending.filter((entry) => entry.expiresAt > now)
  }

  function scheduleExpiry(): void {
    clearTimeout(timer)
    timer = undefined
    if (phase === "closed" || pending.length === 0) return
    const deadline = Math.min(...pending.map((entry) => entry.expiresAt))
    timer = setTimeout(
      () => {
        timer = undefined
        pruneExpired()
        scheduleExpiry()
        void drain()
      },
      Math.max(1, deadline - performance.now()),
    )
    timer.unref()
  }

  async function drain(): Promise<void> {
    if (phase !== "ready" || delivering) return
    pruneExpired()
    const entry = pending.shift()
    scheduleExpiry()
    if (!entry) return
    delivering = true
    try {
      await options.onCallback(entry.url)
    } catch {
      // 原异常可能含回调 URL/code；只记录固定诊断，不中断后续收件。
      console.error("AUTHORIZATION_CALLBACK_DELIVERY_FAILED")
    } finally {
      delivering = false
      void drain()
    }
  }

  function clearPending(): void {
    pending = []
    clearTimeout(timer)
    timer = undefined
  }

  return {
    receiveArguments,
    ready() {
      if (phase === "closed") return
      phase = "ready"
      void drain()
    },
    clearPending,
    dispose() {
      if (phase === "closed") return
      phase = "closed"
      clearPending()
      options.app.removeListener("open-url", openUrl)
      options.app.removeListener("second-instance", secondInstance)
    },
  }
}

function isCandidate(url: string): boolean {
  return (
    typeof url === "string" &&
    url.length <= maxUrlBytes &&
    Buffer.byteLength(url, "utf8") <= maxUrlBytes &&
    url.split(/[?#]/, 1)[0] === privateAuthorizationRedirectUri
  )
}
