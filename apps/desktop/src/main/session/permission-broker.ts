// 负责把 SDK 的 canUseTool 转成 renderer 可回答的权限请求；
// 处理 allow/deny 写回、取消、窗口关闭、会员失效和 10 分钟超时，工具输入不落盘也不写日志。
// 请求放在会话共用的待答队列里，和提问一起计时、一起被整体拒绝。

import { randomUUID } from "node:crypto"
import type {
  PermissionBehavior,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  PermissionUpdateDestination,
} from "@anthropic-ai/claude-agent-sdk"
import type { PendingAnswers, PendingOutcome } from "./pending-answers"

/** 权限请求被取消时给 SDK 的说明；会话释放时整体拒绝也用它。 */
export const cancelledPermissionMessage = "权限请求已取消"
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

/**
 * 权限代理依赖；请求放进会话共用的待答队列，超时和整体拒绝都由队列负责。
 * emit 负责把请求送到 renderer，onTimeout 负责结束当前 turn。
 */
export type PermissionBrokerOptions = {
  queue: PendingAnswers
  emit: (request: PermissionRequestEvent) => void
  onTimeout?: (request: PermissionRequestEvent) => void
  newRequestId?: () => string
}

/** canUseTool 中权限代理用到的选项；SDK 多给的字段会被忽略。 */
export type PermissionRequestOptions = {
  signal: AbortSignal
  suggestions?: PermissionUpdate[]
  blockedPath?: string
}

/** 权限请求的代理。保证每个请求只结算一次；中止、超时和整体拒绝时按拒绝写回。 */
export class PermissionBroker {
  readonly #emit: (request: PermissionRequestEvent) => void
  readonly #onTimeout: ((request: PermissionRequestEvent) => void) | undefined
  readonly #newRequestId: () => string
  readonly #queue: PendingAnswers
  readonly #inputs = new Map<string, Record<string, unknown>>()

  /** 创建权限代理；请求 id 是全局唯一的 UUID。 */
  constructor(options: PermissionBrokerOptions) {
    this.#emit = options.emit
    this.#onTimeout = options.onTimeout
    this.#newRequestId = options.newRequestId ?? (() => randomUUID())
    this.#queue = options.queue
  }

  /** 当前未回答的权限请求数，只用于脱敏状态展示。 */
  get pendingCount(): number {
    return this.#queue.count("permission")
  }

  /** 发起一次权限请求并等待 renderer 回答；signal 已中止时直接拒绝且不发事件。 */
  request(
    toolName: string,
    input: Record<string, unknown>,
    options: PermissionRequestOptions,
  ): Promise<PermissionResult> {
    if (options.signal.aborted) {
      return Promise.resolve({ behavior: "deny", message: cancelledPermissionMessage })
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
      this.#inputs.set(request.requestId, input)
      this.#queue.add(request.requestId, {
        kind: "permission",
        signal: options.signal,
        settle: (outcome) => {
          this.#inputs.delete(request.requestId)
          resolve(permissionResult(outcome))
        },
        onTimeout: () => this.#onTimeout?.(request),
      })
      this.#emitSafely(request)
    })
  }

  /** 写回一次回答；未知或已结算的 requestId 直接忽略，避免超时后的迟到点击报错。 */
  respond(answer: PermissionAnswer): boolean {
    if (answer.decision !== "allow" && answer.decision !== "deny") {
      throw new Error("invalid permission decision")
    }
    const input = this.#inputs.get(answer.requestId)
    if (input === undefined) return false
    if (answer.decision === "deny") {
      return this.#queue.answer(answer.requestId, "permission", {
        behavior: "deny",
        message: deniedMessage,
      })
    }
    const updatedPermissions =
      answer.updatedPermissions === undefined
        ? undefined
        : readPermissionUpdates(answer.updatedPermissions)
    return this.#queue.answer(answer.requestId, "permission", {
      behavior: "allow",
      updatedInput: input,
      ...(updatedPermissions === undefined ? {} : { updatedPermissions }),
    })
  }

  #emitSafely(request: PermissionRequestEvent): void {
    try {
      this.#emit(request)
    } catch {
      // 单个事件订阅者失败不能挂起 SDK 的 canUseTool。
    }
  }
}

function permissionResult(outcome: PendingOutcome): PermissionResult {
  if (outcome.type === "answered") return outcome.result
  switch (outcome.reason) {
    case "aborted":
      return { behavior: "deny", message: cancelledPermissionMessage }
    case "timeout":
      return { behavior: "deny", message: timeoutMessage }
    case "rejected":
      return { behavior: "deny", message: outcome.message }
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
