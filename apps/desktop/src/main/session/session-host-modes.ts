// 负责会话权限模式的切换和跟随：主进程发出的切换交给 Claude Code 核实，自动审批被拒时说明原因并落到真实模式；
// Claude Code 自己改模式时照实跟随，收回自动审批时提示。界面只显示这里广播的模式。

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk"
import type { SessionPermissionMode } from "./session-events"
import type { SessionAdapterPort, SessionNoticeEvent } from "./session-types"

/** 会话里和权限模式有关的状态；活动会话满足它。 */
export type ModeState = {
  adapter: Pick<SessionAdapterPort, "setPermissionMode">
  /** 当前生效并已广播给界面的模式。 */
  permissionMode: SessionPermissionMode
  /** 主进程请求过、Claude Code 还没用 status 确认的模式，按请求顺序。 */
  unconfirmedModes: SessionPermissionMode[]
}

/** 模式模块广播的事件：生效模式的变化和给用户的提示。 */
export type ModeEvent = { type: "mode"; permissionMode: SessionPermissionMode } | SessionNoticeEvent

type EmitModeEvent = (event: ModeEvent) => void

const modeLabels: Record<SessionPermissionMode, string> = {
  default: "监督审批",
  acceptEdits: "接受编辑",
  auto: "自动审批",
  bypassPermissions: "完全访问",
  plan: "计划",
}

const autoRefusalReasons: Record<string, string> = {
  auto_mode_circuit_breaker: "当前 Claude 账号的订阅不支持",
  auto_mode_model: "当前模型不支持",
  auto_mode_fast_mode: "快速模式开启时不能使用",
  auto_mode_settings: "已被设置关闭",
}

const autoRefusalPrefix = "Cannot set permission mode to auto"

/** CLI 的启动模式。以自动审批启动时 CLI 不可用会静默退回，所以先按监督审批启动，再切换拿到明确结果。 */
export function launchPermissionMode(mode: SessionPermissionMode): SessionPermissionMode {
  return mode === "auto" ? "default" : mode
}

/** 会话启动后进入用户选的模式；进不去时留在启动模式并提示原因，从不抛错。 */
export async function enterRequestedMode(
  state: ModeState,
  requested: SessionPermissionMode,
  emit: EmitModeEvent,
): Promise<void> {
  if (requested === state.permissionMode) return
  try {
    await switchPermissionMode(state, requested, emit)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    emit({ type: "notice", message: unavailableNotice(requested, reason, state.permissionMode) })
  }
}

/**
 * 切换权限模式。Claude Code 拒绝自动审批时不抛错，保持原模式并提示原因；原模式是计划时改回监督审批，
 * 因为用户已经要求离开计划。其他失败照常抛出，模式不变。
 */
export async function switchPermissionMode(
  state: ModeState,
  mode: SessionPermissionMode,
  emit: EmitModeEvent,
): Promise<void> {
  try {
    await requestMode(state, mode, emit)
  } catch (error) {
    const reason = autoRefusalReason(mode, error)
    if (reason === null) throw error
    if (state.permissionMode !== "plan") {
      emit({ type: "notice", message: unavailableNotice(mode, reason, state.permissionMode) })
      return
    }
    await requestMode(state, "default", emit)
    emit({
      type: "notice",
      message: `${modeLabels[mode]}不可用：${reason}。已关闭计划，会话按监督审批运行。`,
    })
  }
}

/**
 * 跟随 Claude Code 报告的模式。status 报回主进程请求过的模式时只用来对账；还有请求没报回时，
 * 中途的其他报告会被后面的请求覆盖，不跟随。Claude Code 自己把自动审批改回监督审批时提示用户。
 */
export function followReportedMode(
  state: ModeState,
  reported: PermissionMode,
  source: "status" | "init",
  emit: EmitModeEvent,
): void {
  if (!isSessionPermissionMode(reported)) return
  const confirmed = source === "status" ? state.unconfirmedModes.indexOf(reported) : -1
  if (confirmed >= 0) {
    state.unconfirmedModes.splice(0, confirmed + 1)
    return
  }
  if (state.unconfirmedModes.length > 0) return
  const previous = state.permissionMode
  applyMode(state, reported, emit)
  if (source === "status" && previous === "auto" && reported === "default") {
    emit({ type: "notice", message: "Claude Code 关闭了自动审批，会话按监督审批运行。" })
  }
}

async function requestMode(
  state: ModeState,
  mode: SessionPermissionMode,
  emit: EmitModeEvent,
): Promise<void> {
  const expected = state.unconfirmedModes.at(-1) ?? state.permissionMode
  const awaitsConfirmation = mode !== expected
  if (awaitsConfirmation) state.unconfirmedModes.push(mode)
  try {
    await state.adapter.setPermissionMode(mode)
  } catch (error) {
    if (awaitsConfirmation) dropLast(state.unconfirmedModes, mode)
    throw error
  }
  applyMode(state, mode, emit)
}

function applyMode(state: ModeState, mode: SessionPermissionMode, emit: EmitModeEvent): void {
  if (state.permissionMode === mode) return
  state.permissionMode = mode
  emit({ type: "mode", permissionMode: mode })
}

function unavailableNotice(
  mode: SessionPermissionMode,
  reason: string,
  current: SessionPermissionMode,
): string {
  return `${modeLabels[mode]}不可用：${reason}。会话按${modeLabels[current]}运行。`
}

// SDK 把 CLI 的拒绝原文作为消息，把错误码挂在 errorCode 上。
function autoRefusalReason(mode: SessionPermissionMode, error: unknown): string | null {
  if (mode !== "auto" || !(error instanceof Error)) return null
  const code = "errorCode" in error && typeof error.errorCode === "string" ? error.errorCode : ""
  if (!error.message.startsWith(autoRefusalPrefix) && !code.startsWith("auto_mode_")) return null
  if (error.message.includes("not known yet")) return "Claude Code 还没确认能否使用，请稍后再试"
  const mapped = autoRefusalReasons[code]
  if (mapped !== undefined) return mapped
  const detail = error.message.startsWith(autoRefusalPrefix)
    ? error.message.slice(autoRefusalPrefix.length).replace(/^:\s*/, "").trim()
    : ""
  return detail === "" ? "Claude Code 没有说明原因" : detail
}

function isSessionPermissionMode(mode: PermissionMode): mode is SessionPermissionMode {
  return Object.hasOwn(modeLabels, mode)
}

function dropLast(modes: SessionPermissionMode[], mode: SessionPermissionMode): void {
  const index = modes.lastIndexOf(mode)
  if (index >= 0) modes.splice(index, 1)
}
