// 负责展示单个 Claude 账号的额度、网络出口、指纹和凭据状态。
import { SettingPage, SettingRow, SettingSection } from "@pigclaude/ui-primitives"
import { desktopText } from "../locale/text"
import { Button } from "../components/ui/button"
import { Icon } from "../components/icon"
import { FingerprintSummary } from "../components/fingerprint-summary"
import type { PoolAccount } from "../fixtures/pool-fixtures"
import { accountNetworkLabel } from "../models/claude-account-view"

/** 账号详情页面 props。 */
export type AccountDetailScreenProps = {
  account: PoolAccount
  browserProfileName?: string | undefined
  onChangeBrowserProfile?: () => void
  onBack: () => void
  onReauthorize: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  onChangeProxy: () => void
  onEditFingerprint: () => void
}

/** 绘制账号详情和操作入口。 */
export function AccountDetailScreen({
  account,
  browserProfileName,
  onChangeBrowserProfile,
  onBack,
  onReauthorize,
  onDelete,
  onToggleEnabled,
  onChangeProxy,
  onEditFingerprint,
}: AccountDetailScreenProps) {
  const subtitle = [
    desktopText("pool.account-detail-screen.subscription"),
    account.status,
    account.email,
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <SettingPage
      title={account.name}
      sub={subtitle}
      actions={
        <>
          <Button variant="ghost" type="button" onClick={onBack}>
            <Icon name="left" small />
            {desktopText("pool.account-detail-screen.back")}
          </Button>
          <Button variant="primary" onClick={onReauthorize}>
            {desktopText("pool.account-detail-screen.reauthorize")}
          </Button>
          <Button variant="secondary" onClick={onToggleEnabled}>
            {desktopText(
              account.enabled
                ? "pool.account-detail-screen.disable"
                : "pool.account-detail-screen.enable",
            )}
          </Button>
          <Button variant="danger" onClick={onDelete}>
            {desktopText("pool.account-detail-screen.delete")}
          </Button>
        </>
      }
    >
      {account.browserProfileId ? (
        <SettingSection title={desktopText("pool.account-detail-screen.browserProfile")}>
          <SettingRow
            title={browserProfileName ?? desktopText("pool.account-detail-screen.profileFallback")}
            description={desktopText("pool.account-detail-screen.profileDescription")}
          >
            <Button size="sm" onClick={onChangeBrowserProfile}>
              {desktopText("pool.account-detail-screen.changeProfile")}
            </Button>
          </SettingRow>
        </SettingSection>
      ) : null}
      <SettingSection title={desktopText("pool.account-detail-screen.quota")}>
        <SettingRow
          title={desktopText("pool.account-detail-screen.fiveHour")}
          description={desktopText("pool.account-detail-screen.fiveHourDescription")}
          value={account.usage === null ? "—" : `${account.usage}%`}
        />
        <SettingRow
          title={desktopText("pool.account-detail-screen.sevenDay")}
          description={desktopText("pool.account-detail-screen.sevenDayDescription")}
          value={
            account.usage === null ? "—" : desktopText("pool.account-detail-screen.quotaNormal")
          }
        />
        {account.statusKind === "cooldown" ? (
          <SettingRow
            title={desktopText("pool.account-detail-screen.cooldown")}
            description={desktopText("pool.account-detail-screen.cooldownDescription")}
            value={<span className="status warn">{cooldownText(account.cooldownUntil)}</span>}
          />
        ) : null}
      </SettingSection>
      <SettingSection title={desktopText("pool.account-detail-screen.network")}>
        <SettingRow
          title={accountNetworkLabel(account)}
          description={
            account.proxyId === null
              ? desktopText("pool.account-detail-screen.systemNetwork")
              : account.proxyExit
                ? desktopText("pool.account-detail-screen.sharedEgress", {
                    value1: account.proxyExit,
                  })
                : desktopText("pool.account-detail-screen.proxyUnavailable")
          }
        >
          <Button size="sm" onClick={onChangeProxy}>
            {desktopText("pool.account-detail-screen.changeNetwork")}
          </Button>
        </SettingRow>
      </SettingSection>
      <SettingSection
        title={desktopText("pool.account-detail-screen.fingerprint")}
        plain
        actions={
          <Button variant="ghost" size="sm" type="button" onClick={onEditFingerprint}>
            {desktopText(
              account.browserProfileId
                ? "pool.account-detail-screen.editSharedProfile"
                : "pool.account-detail-screen.editFingerprint",
            )}
          </Button>
        }
      >
        <FingerprintSummary
          fingerprint={account.fingerprintDetail}
          fallbackSeed={account.fingerprint}
        />
        <p className="section-note">
          {desktopText(
            account.browserProfileId
              ? "pool.account-detail-screen.sharedProfileDescription"
              : "pool.account-detail-screen.fingerprintDescription",
          )}
        </p>
      </SettingSection>
      <SettingSection title={desktopText("pool.account-detail-screen.credentials")}>
        <SettingRow
          title={desktopText("pool.account-detail-screen.storedLocally")}
          description={desktopText("pool.account-detail-screen.credentialUse")}
          value={
            <span className={account.needsReauth ? "status bad" : "status ok"}>
              {desktopText(
                account.needsReauth
                  ? "pool.account-detail-screen.needsReauth"
                  : "pool.account-detail-screen.stored",
              )}
            </span>
          }
        />
      </SettingSection>
    </SettingPage>
  )
}

function cooldownText(value: string | null): string {
  if (value === null) return desktopText("pool.account-detail-screen.cooling")
  const until = Date.parse(value)
  if (!Number.isFinite(until)) return desktopText("pool.account-detail-screen.unknownCooldown")
  return desktopText("pool.account-detail-screen.cooldownUntil", {
    value1: String(
      new Date(until).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    ),
  })
}
