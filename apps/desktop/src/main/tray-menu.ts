// 从脱敏的会话、Claude 账号、会员和定时任务摘要生成托盘菜单。

import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { MembershipState } from "@pigclaude/contracts/membership"
import type { ScheduledTaskSummary } from "../scheduled-tasks-contract"
import { scheduledLocalTime, scheduledProjectName } from "./scheduled-tasks/presentation"
import type { WindowNavigationCommand } from "../window-navigation-contract"
import type { LiveSessionPreview } from "./session/session-summary"

/** Claude 账号只用来统计需要处理的状态。 */
export type TrayAccount = Pick<ClaudeAccountView, "enabled" | "needsReauth" | "exhaustedUntil">

/** 托盘项可以导航、唤回、暂停排期或进入正常退出流程。 */
export type TrayMenuAction =
  | WindowNavigationCommand
  | { kind: "open-window" }
  | { kind: "quit" }
  | { kind: "pause-scheduled-tasks" }

/** Electron 之外的菜单数据；没有操作或子菜单的项展示为不可点击的状态。 */
export type TrayMenuItem =
  | { type: "separator" }
  | { id: string; label: string; action?: TrayMenuAction; submenu?: readonly TrayMenuItem[] }

const membershipLabels: Record<MembershipState, string> = {
  active: "会员有效",
  connecting: "正在核验会员",
  network_grace: "会员核验暂时失败",
  offline_grace: "离线可用",
  expired: "会员已到期",
  verification_required: "会员需要重新验证",
  device_revoked: "设备授权已撤销",
  signed_out: "未登录",
  configuration_error: "会员配置不可用",
  error: "会员不可用",
}

/** 生成运行会话、全部待审批以及可用的定时任务操作。 */
export function buildTrayMenu({
  membership,
  sessions,
  accounts,
  scheduledTasks,
  now,
}: {
  membership: MembershipState
  sessions: readonly LiveSessionPreview[]
  accounts: readonly TrayAccount[]
  scheduledTasks?: ScheduledTaskSummary
  now: number
}): { items: TrayMenuItem[]; pendingApprovals: number } {
  const items: TrayMenuItem[] = [{ id: "membership", label: membershipLabels[membership] }]
  const sessionLabels = labelsFor(sessions)
  const openSession = (sessionId: string): WindowNavigationCommand => ({
    kind: "session",
    sessionId,
  })
  const live = sessions.slice(0, 5).map(({ sessionId }, index) => ({
    id: `session-${sessionId}`,
    label: sessionLabels[index] ?? "会话",
    action: openSession(sessionId),
  }))
  items.push({
    id: "sessions",
    label: `运行中的会话（${sessions.length}）`,
    ...(live.length === 0 ? {} : { submenu: live }),
  })
  const pending = sessions.flatMap(({ sessionId, pendingApprovals }, index) =>
    pendingApprovals > 0
      ? [{ sessionId, pendingApprovals, label: sessionLabels[index] ?? "会话" }]
      : [],
  )
  const pendingApprovals = pending.reduce((total, item) => total + item.pendingApprovals, 0)
  const onlyPending = pending.length === 1 ? pending[0] : undefined
  items.push({
    id: "approvals",
    label: `待审批（${pendingApprovals}）`,
    ...(onlyPending
      ? { action: openSession(onlyPending.sessionId) }
      : pending.length === 0
        ? {}
        : {
            submenu: pending.map(({ label, pendingApprovals, sessionId }) => ({
              id: `approval-${sessionId}`,
              label: `${label}（${pendingApprovals}）`,
              action: openSession(sessionId),
            })),
          }),
  })
  const attention = accounts.filter(
    ({ enabled, needsReauth, exhaustedUntil }) =>
      !enabled || needsReauth || (exhaustedUntil != null && Date.parse(exhaustedUntil) > now),
  ).length
  items.push({
    id: "accounts",
    label: `Claude 账号需要处理（${attention}）`,
    ...(attention === 0 ? {} : { action: { kind: "accounts" } }),
  })
  if (scheduledTasks) {
    const next = scheduledTasks.next
    if (next && next.nextRunAt !== null)
      items.push({
        id: "next-scheduled-task",
        label: `下次定时任务 · ${scheduledProjectName(next.projectPath)} · ${scheduledLocalTime(next.nextRunAt)}`,
      })
    items.push({
      id: "pause-scheduled-tasks",
      label: "暂停全部定时任务",
      ...(scheduledTasks.enabled.length > 0 ? { action: { kind: "pause-scheduled-tasks" } } : {}),
    })
  }
  items.push({ type: "separator" })
  if (membership === "active")
    items.push({ id: "new-session", label: "新会话", action: { kind: "new-session" } })
  items.push(
    { id: "open-window", label: "打开窗口", action: { kind: "open-window" } },
    { id: "quit", label: "退出", action: { kind: "quit" } },
  )
  return { items, pendingApprovals }
}

function labelsFor(sessions: readonly LiveSessionPreview[]): string[] {
  const labels = sessions.map(({ projectName, title }) => {
    const project = cleanLabel(projectName) || "会话"
    const name = title === null ? "" : cleanLabel(title)
    return name ? `${name} · ${project}` : project
  })
  const seen = new Map<string, number>()
  return labels.map((label) => {
    const count = (seen.get(label) ?? 0) + 1
    seen.set(label, count)
    return count === 1 ? label : `${label}（${count}）`
  })
}

function cleanLabel(value: string): string {
  return Array.from(value.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim())
    .slice(0, 64)
    .join("")
}
