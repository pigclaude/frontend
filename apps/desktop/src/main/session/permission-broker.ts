// 负责把 SDK 的 canUseTool 转成 renderer 可回答的权限请求；
// 处理 allow/deny 写回、取消、窗口关闭、会员失效和 10 分钟超时，工具输入不落盘也不写日志。
// 请求放在会话共用的待答队列里，和提问一起计时、一起被整体拒绝。

import { randomUUID } from "node:crypto"
import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk"
import type {
  PermissionSuggestionSelection,
  PermissionSuggestionView,
  ProjectPermissionGrant,
} from "../../project-permissions-contract"
import { projectPermissionGrants } from "./project-permission-grants"
import type { PendingAnswers, PendingOutcome } from "./pending-answers"
import type { SubagentRef } from "./session-events"

/** 权限请求被取消时给 SDK 的说明；会话释放时整体拒绝也用它。 */
export const cancelledPermissionMessage = "权限请求已取消"
const timeoutMessage = "权限询问超时"
const deniedMessage = "用户拒绝了该操作"

/** 发给 renderer 的权限请求；只含展示所需字段。子代理发起的请求带上它的归属。 */
export type PermissionRequestEvent = {
  type: "permission"
  requestId: string
  toolName: string
  input: Record<string, unknown>
  suggestions?: PermissionSuggestionView[]
  defaultToNo?: boolean
  blockedPath?: string
  /** 子代理发起的请求是它的归属；主线程为 null。 */
  subagent: SubagentRef | null
}

/** renderer 的权限回答；只能引用主进程保留的建议序号。 */
export type PermissionAnswer = {
  requestId: string
  decision: "allow" | "deny"
  suggestion?: PermissionSuggestionSelection
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
  /** 按 SDK 给的 agent id 找回子代理归属；没有 agent id 时是主线程。 */
  subagentOf: (agentId: string | undefined) => SubagentRef | null
  /** 保存一条已经明确确认的项目授权。 */
  saveProjectGrants?: (
    grants: ProjectPermissionGrant[],
    stillPending: () => boolean,
  ) => Promise<void>
}

/** canUseTool 中权限代理用到的选项；SDK 多给的字段会被忽略。 */
export type PermissionRequestOptions = {
  signal: AbortSignal
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  defaultToNo?: boolean
  suppressAlwaysAllowRule?: boolean
  /** 请求来自子代理时，SDK 给出的子代理 agent id。 */
  agentID?: string
}

type PendingPermission = {
  input: Record<string, unknown>
  suggestions: Array<PermissionUpdate | undefined>
  saving: boolean
}

/** 权限请求的代理。保证每个请求只结算一次；中止、超时和整体拒绝时按拒绝写回。 */
export class PermissionBroker {
  readonly #emit: (request: PermissionRequestEvent) => void
  readonly #onTimeout: ((request: PermissionRequestEvent) => void) | undefined
  readonly #newRequestId: () => string
  readonly #subagentOf: (agentId: string | undefined) => SubagentRef | null
  readonly #queue: PendingAnswers
  readonly #requests = new Map<string, PendingPermission>()
  readonly #saveProjectGrants: PermissionBrokerOptions["saveProjectGrants"]

  /** 创建权限代理；请求 id 是全局唯一的 UUID。 */
  constructor(options: PermissionBrokerOptions) {
    this.#emit = options.emit
    this.#onTimeout = options.onTimeout
    this.#newRequestId = options.newRequestId ?? (() => randomUUID())
    this.#subagentOf = options.subagentOf
    this.#queue = options.queue
    this.#saveProjectGrants = options.saveProjectGrants
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
    const suggestions = options.suppressAlwaysAllowRule
      ? []
      : structuredClone(options.suggestions ?? []).map((update) =>
          projectPermissionGrants(update).length === 0 ? undefined : sessionOnly(update),
        )
    const choices = suggestions.flatMap((suggestion, index) =>
      suggestion === undefined ? [] : [this.#suggestion(suggestion, index)],
    )
    const request: PermissionRequestEvent = {
      type: "permission",
      requestId: this.#newRequestId(),
      toolName,
      input,
      ...(choices.length === 0 ? {} : { suggestions: choices }),
      ...(options.defaultToNo ? { defaultToNo: true } : {}),
      ...(options.blockedPath === undefined ? {} : { blockedPath: options.blockedPath }),
      subagent: this.#subagentOf(options.agentID),
    }
    return new Promise<PermissionResult>((resolve) => {
      this.#requests.set(request.requestId, { input, suggestions, saving: false })
      this.#queue.add(request.requestId, {
        kind: "permission",
        signal: options.signal,
        settle: (outcome) => {
          this.#requests.delete(request.requestId)
          resolve(permissionResult(outcome))
        },
        onTimeout: () => this.#onTimeout?.(request),
      })
      this.#emitSafely(request)
    })
  }

  /** 写回一次回答；未知或已结算的 requestId 直接忽略，避免超时后的迟到点击报错。 */
  async respond(answer: PermissionAnswer): Promise<boolean> {
    if (answer.decision !== "allow" && answer.decision !== "deny") {
      throw new Error("invalid permission decision")
    }
    const pending = this.#requests.get(answer.requestId)
    if (pending === undefined || pending.saving) return false
    if (answer.decision === "deny") {
      return this.#queue.answer(answer.requestId, "permission", {
        behavior: "deny",
        message: deniedMessage,
      })
    }
    const selection = answer.suggestion
    const suggestion = selection === undefined ? undefined : pending.suggestions[selection.index]
    if (selection !== undefined && suggestion === undefined)
      throw new Error("INVALID_SESSION_INPUT")
    if (selection?.scope === "project" && suggestion !== undefined) {
      const grants = projectPermissionGrants(suggestion)
      if (!this.#saveProjectGrants || grants.length === 0) throw new Error("INVALID_SESSION_INPUT")
      pending.saving = true
      try {
        await this.#saveProjectGrants(
          grants,
          () => this.#requests.get(answer.requestId) === pending,
        )
      } finally {
        pending.saving = false
      }
    }
    return this.#queue.answer(answer.requestId, "permission", {
      behavior: "allow",
      updatedInput: pending.input,
      ...(suggestion !== undefined && selection?.scope === "session"
        ? { updatedPermissions: [suggestion] }
        : {}),
    })
  }

  #suggestion(update: PermissionUpdate, index: number): PermissionSuggestionView {
    const grants = projectPermissionGrants(update)
    return {
      index,
      label: grants.map(({ value }) => value).join(" · "),
      canSaveProject: this.#saveProjectGrants !== undefined && grants.length > 0,
      ...(update.type === "addDirectories" ? { kind: "directory" as const } : {}),
    }
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

function sessionOnly(update: PermissionUpdate): PermissionUpdate {
  return { ...update, destination: "session" }
}
