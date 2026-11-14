// 负责「我的账户」和「切换规则」两个设置页。
import { desktopText } from "../../locale/text"
import { WithdrawAuthorization } from "../../components/withdraw-authorization"
import { Icon } from "../../components/icon"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import { Button } from "../../components/ui/button"
import type { NavLocation } from "../../models/navigation"
import { SettingPage, SettingRow, SettingSection } from "./setting-page"
import { DefaultAccountRow } from "./session-default-rows"

/** 我的账户：pigclaude 使用权限，不涉及 Claude 订阅账号。 */
export function ProfileSettings({
  membership,
  onLogout,
  withdrawContextId,
}: {
  membership: MembershipView
  onLogout: () => void
  withdrawContextId?: string | undefined
}) {
  const accountName = membership.account?.nickname || "—"
  const accountEmail = membership.account?.email || "—"
  const verifiedAt = membership.lastVerifiedAt ? formatDateTime(membership.lastVerifiedAt) : "—"
  const membershipStatus =
    membership.state === "active" ? desktopText("settings.settings-account-pages.1") : "—"
  return (
    <SettingPage
      title={desktopText("settings.settings-account-pages.2")}
      sub={desktopText("settings.settings-account-pages.3")}
    >
      <div className="group">
        <div className="me">
          <span className="avatar lg">{Array.from(accountName)[0] ?? "—"}</span>
          <div className="grow">
            <div className="me-name">{accountName}</div>
            <div className="muted">{accountEmail}</div>
          </div>
        </div>
      </div>
      <SettingSection title={desktopText("settings.settings-account-pages.4")}>
        <SettingRow title={desktopText("settings.settings-account-pages.5")}>
          <span className={membership.state === "active" ? "status ok" : "status"}>
            {membershipStatus}
          </span>
        </SettingRow>
        <SettingRow
          title={desktopText("settings.settings-account-pages.6")}
          description={desktopText("settings.settings-account-pages.7")}
          value={verifiedAt}
        />
      </SettingSection>
      <SettingSection title={desktopText("settings.settings-account-pages.8")}>
        <SettingRow
          title={desktopText("settings.settings-account-pages.9")}
          description={desktopText("settings.settings-account-pages.10")}
        >
          <span className="val">{desktopText("settings.settings-account-pages.11")}</span>
        </SettingRow>
        <SettingRow title={desktopText("settings.settings-account-pages.12")} value="—" />
      </SettingSection>
      <p className="note">
        <Icon name="lock" small />
        {desktopText("settings.settings-account-pages.13")}
      </p>
      <div className="setup-actions">
        <WithdrawAuthorization contextId={withdrawContextId} />
        <Button onClick={onLogout}>
          <Icon name="exit" />
          {desktopText("settings.settings-account-pages.14")}
        </Button>
      </div>
    </SettingPage>
  )
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })
}

/** 切换规则：新会话用哪个账号，以及什么时候从一个 Claude 账号换到下一个；未接入用量的阈值显示「—」。 */
export function SwitchingSettings({
  accounts = [],
  onNavigate,
}: {
  accounts?: readonly ClaudeAccountView[]
  onNavigate: (location: NavLocation) => void
}) {
  return (
    <SettingPage
      title={desktopText("settings.settings-account-pages.15")}
      sub={desktopText("settings.settings-account-pages.16")}
    >
      <SettingSection>
        <DefaultAccountRow accounts={accounts} />
        <SettingRow title={desktopText("settings.settings-account-pages.17")} value="—" />
        <SettingRow title={desktopText("settings.settings-account-pages.20")} value="—" />
        <SettingRow title={desktopText("settings.settings-account-pages.22")} value="—" />
        <SettingRow title={desktopText("settings.settings-account-pages.25")} value="—" />
      </SettingSection>
      <p className="note">
        <Icon name="info" small />
        <span>
          {desktopText("settings.settings-account-pages.27")}{" "}
          <Button
            variant="plain"
            className="link"
            type="button"
            onClick={() => onNavigate({ kind: "settings", page: "accounts" })}
          >
            {desktopText("settings.settings-account-pages.28")}
          </Button>{" "}
          {desktopText("settings.settings-account-pages.29")}
        </span>
      </p>
    </SettingPage>
  )
}
