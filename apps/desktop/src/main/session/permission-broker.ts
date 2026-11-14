// 负责把 SDK 的 canUseTool 转成 renderer 可回答的权限请求；
// 处理 allow/deny 写回、取消、窗口关闭、会员失效和 10 分钟超时，工具输入不落盘也不写日志。

import { randomUUID } from "node:crypto"
import type {
  PermissionBehavior,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  PermissionUpdateDestination,
} from "@anthropic-ai/claude-agent-sdk"

const defaultTimeoutMs = 10 * 60 * 1_000
const cancelledMessage = "权限请求已取消"
const timeoutMessage = "权限询问超时"
const deniedMessage = "用户拒绝了该操作"

/** 发给 renderer 的权限请求；只含展示所需字段。 */
export type PermissionRequestEvent = {
  type: "permission"
  requestId: string
  toolName: string
  input: Record<string, unknown>
  suggestions?: unknown[]
  blockedPath?: string
}

/** renderer 的权限回答；updatedPermissions 来自不可信输入，写回前会校验。 */
export type PermissionAnswer = {
  requestId: string
  decision: "allow" | "deny"
  updatedPermissions?: unknown[]
}

/** 权限代理依赖；emit 负责把请求送到 renderer，onTimeout 负责结束当前 turn。 */
export type PermissionBrokerOptions = {
  emit: (request: PermissionRequestEvent) => void
  onTimeout?: (request: PermissionRequestEvent) => void
  timeoutMs?: number
  newRequestId?: () => string
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

/** canUseTool 中权限代理用到的选项；SDK 多给的字段会被忽略。 */
export type PermissionRequestOptions = {
  signal: AbortSignal
  suggestions?: PermissionUpdate[]
  blockedPath?: string
}

type PendingRequest = {
  request: PermissionRequestEvent
  resolve: (result: PermissionResult) => void
  timer: ReturnType<typeof setTimeout>
  signal: AbortSignal
  abortListener: () => void
}

/** 权限请求的内存队列。保证每个请求只结算一次；取消、窗口关闭和会员失效时立即 deny 全部未回答请求。 */
export class PermissionBroker {
  readonly #emit: (request: PermissionRequestEvent) => void
  readonly #onTimeout: ((request: PermissionRequestEvent) => void) | undefined
  readonly #timeoutMs: number
  readonly #newRequestId: () => string
  readonly #setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly #clearTimer: (handle: ReturnType<typeof setTimeout>) => void
  readonly #pending = new Map<string, PendingRequest>()

  /** 创建权限代理；默认每个请求 10 分钟后自动拒绝，请求 id 是全局唯一的 UUID。 */
  constructor(options: PermissionBrokerOptions) {
    this.#emit = options.emit
    this.#onTimeout = options.onTimeout
    this.#timeoutMs = options.timeoutMs ?? defaultTimeoutMs
    this.#newRequestId = options.newRequestId ?? (() => randomUUID())
    this.#setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))
  }

  /** 当前未回答请求数，只用于脱敏状态展示。 */
  get pendingCount(): number {
    return this.#pending.size
  }

  /** 发起一次权限请求并等待 renderer 回答；signal 已中止时直接拒绝且不发事件。 */
  request(
    toolName: string,
    input: Record<string, unknown>,
    options: PermissionRequestOptions,
  ): Promise<PermissionResult> {
    if (options.signal.aborted) {
      return Promise.resolve({ behavior: "deny", message: cancelledMessage })
    }
    const request: PermissionRequestEvent = {
      type: "permission",
      requestId: this.#newRequestId(),
      toolName,
      input,
      ...(options.suggestions === undefined ? {} : { suggestions: options.suggestions }),
      ...(options.blockedPath === undefined ? {} : { blockedPath: options.blockedPath }),
    }
    return new Promise<PermissionResult>((resolve) => {
      const abortListener = (): void => {
        this.#settle(request.requestId, { behavior: "deny", message: cancelledMessage })
      }
      const pending: PendingRequest = {
        request,
        resolve,
        timer: this.#setTimer(() => this.#handleTimeout(request), this.#timeoutMs),
        signal: options.signal,
        abortListener,
      }
      options.signal.addEventListener("abort", abortListener, { once: true })
      this.#pending.set(request.requestId, pending)
      this.#emitSafely(request)
    })
  }

  /** 写回一次回答；未知或已结算的 requestId 直接忽略，避免超时后的迟到点击报错。 */
  respond(answer: PermissionAnswer): boolean {
    if (answer.decision !== "allow" && answer.decision !== "deny") {
      throw new Error("invalid permission decision")
    }
    const pending = this.#pending.get(answer.requestId)
    if (pending === undefined) return false
    if (answer.decision === "deny") {
      this.#settle(answer.requestId, { behavior: "deny", message: deniedMessage })
      return true
    }
    const updatedPermissions =
      answer.updatedPermissions === undefined
        ? undefined
        : readPermissionUpdates(answer.updatedPermissions)
    this.#settle(answer.requestId, {
      behavior: "allow",
      updatedInput: pending.request.input,
      ...(updatedPermissions === undefined ? {} : { updatedPermissions }),
    })
    return true
  }

  /** 立即拒绝所有未回答请求；用于停止、取消、窗口关闭和会员失效。 */
  rejectAll(message: string): void {
    for (const requestId of [...this.#pending.keys()]) {
      this.#settle(requestId, { behavior: "deny", message })
    }
  }

  /** 清理定时器和监听器；拒绝仍挂起的请求。 */
  dispose(): void {
    this.rejectAll(cancelledMessage)
  }

  #handleTimeout(request: PermissionRequestEvent): void {
    if (!this.#pending.has(request.requestId)) return
    this.#settle(request.requestId, { behavior: "deny", message: timeoutMessage })
    try {
      this.#onTimeout?.(request)
    } catch {
      // 超时回调失败不能留下未结算的权限 Promise。
    }
  }

  // 所有路径共用：先从队列移除，再清理定时器和 abort 监听，最后 resolve。
  #settle(requestId: string, result: PermissionResult): void {
    const pending = this.#pending.get(requestId)
    if (pending === undefined) return
    this.#pending.delete(requestId)
    this.#clearTimer(pending.timer)
    pending.signal.removeEventListener("abort", pending.abortListener)
    pending.resolve(result)
  }

  #emitSafely(request: PermissionRequestEvent): void {
    try {
      this.#emit(request)
    } catch {
      // 单个事件订阅者失败不能挂起 SDK 的 canUseTool。
    }
  }
}

function readPermissionUpdates(value: unknown[]): PermissionUpdate[] {
  return value.map((item) => readPermissionUpdate(item))
}

function readPermissionUpdate(value: unknown): PermissionUpdate {
  if (!isRecord(value)) throw new Error("invalid permission update")
  const destination = readDestination(value.destination)
  switch (value.type) {
    case "addRules":
    case "replaceRules":
    case "removeRules":
      return {
        type: value.type,
        rules: readRules(value.rules),
        behavior: readBehavior(value.behavior),
        destination,
      }
    case "setMode":
      return { type: "setMode", mode: readMode(value.mode), destination }
    case "addDirectories":
    case "removeDirectories":
      return { type: value.type, directories: readStrings(value.directories), destination }
    default:
      throw new Error("invalid permission update")
  }
}

function readRules(value: unknown): { toolName: string; ruleContent?: string }[] {
  if (!Array.isArray(value)) throw new Error("invalid permission rules")
  return value.map((rule) => {
    if (!isRecord(rule) || typeof rule.toolName !== "string") {
      throw new Error("invalid permission rules")
    }
    return {
      toolName: rule.toolName,
      ...(typeof rule.ruleContent === "string" ? { ruleContent: rule.ruleContent } : {}),
    }
  })
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("invalid permission directories")
  }
  return [...value]
}

function readBehavior(value: unknown): PermissionBehavior {
  if (value === "allow" || value === "deny" || value === "ask") return value
  throw new Error("invalid permission behavior")
}

function readDestination(value: unknown): PermissionUpdateDestination {
  switch (value) {
    case "userSettings":
    case "projectSettings":
    case "localSettings":
    case "session":
    case "cliArg":
      return value
    default:
      throw new Error("invalid permission destination")
  }
}

function readMode(value: unknown): PermissionMode {
  switch (value) {
    case "default":
    case "acceptEdits":
    case "bypassPermissions":
    case "plan":
    case "dontAsk":
    case "auto":
      return value
    default:
      throw new Error("invalid permission mode")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
