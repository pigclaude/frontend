// 负责托盘面板：显示真实会员名称、等级和账号摘要；额度窗口未接入前显示「—」，不伪造百分比。

import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { Button } from "../components/ui/button"
import { Icon } from "../components/icon"

/** 托盘预览页面 props。 */
export type TrayScreenProps = {
  membership: MembershipView
  accounts: ClaudeAccountView[]
  onOpenAccounts: () => void
  onOpenSettings?: () => void
}

/** 绘制托盘面板。 */
export function TrayScreen({
  membership,
  accounts,
  onOpenAccounts,
  onOpenSettings,
}: TrayScreenProps) {
  const attention = accounts.filter((account) => accountNeedsAttention(account))
  return (
    <div className="tray-stage">
      <div className="tray">
        <div className="tray-head">
          <span className="app-ic">
            <Icon name="snout" />
          </span>
          <b>{membershipTitle(membership)}</b>
        </div>
        {attention.length > 0 ? (
          <Button variant="plain" className="item" type="button" onClick={onOpenAccounts}>
            <span className="dot warn" />
            <div className="main">
              <div className="ttl">{attention.length} 个账号需要处理</div>
            </div>
            <Icon name="right" small />
          </Button>
        ) : null}
        {accounts.length === 0 ? (
          <p className="note">还没有 Claude 账号</p>
        ) : (
          <div className="group">
            {accounts.map((account) => (
              <div className="item" key={account.id}>
                <span className="avatar">{account.displayName.slice(0, 1) || "?"}</span>
                <div className="main">
                  <div className="ttl">{account.displayName}</div>
                  <div className="desc">{trayAccountStatus(account)}</div>
                </div>
                <span className={accountNeedsAttention(account) ? "val t-warn" : "val"}>—</span>
              </div>
            ))}
          </div>
        )}
        <div className="row tray-actions">
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            设置
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenAccounts}>
            管理账号
          </Button>
        </div>
      </div>
    </div>
  )
}

function membershipTitle(view: MembershipView): string {
  if (view.account === null) {
    return view.state === "signed_out" ? "未登录" : membershipStateText(view.state)
  }
  return view.tier === null ? view.account.nickname : `${view.account.nickname} · ${view.tier.name}`
}

function membershipStateText(state: MembershipView["state"]): string {
  if (state === "active") return "会员有效"
  if (state === "offline_grace") return "离线可用"
  if (state === "connecting") return "正在连接"
  return "会员不可用"
}

function accountNeedsAttention(account: ClaudeAccountView): boolean {
  if (account.needsReauth || !account.enabled) return true
  if (account.exhaustedUntil === null || account.exhaustedUntil === undefined) return false
  const until = Date.parse(account.exhaustedUntil)
  return Number.isFinite(until) && until > Date.now()
}

function trayAccountStatus(account: ClaudeAccountView): string {
  if (account.needsReauth) return "需重新授权"
  if (!account.enabled) return "已停用"
  return accountNeedsAttention(account) ? "冷却中" : "可用"
}
