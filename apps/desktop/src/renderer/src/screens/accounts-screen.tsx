// 负责展示真实 Claude 账号列表：需要处理（重新授权/停用/冷却）、自动切换顺序和账号详情入口。

import { desktopText } from "../locale/text"
import { useState } from "react"
import {
  ListRow,
  SettingPage,
  SettingSection,
  StatusDot,
  type StatusTone,
} from "@pigclaude/ui-primitives"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { BrowserProfileView } from "@pigclaude/contracts/browser-profile"
import { BrowserProfileSelect } from "../components/browser-profile-select"
import { Button } from "../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"
import { AccountDeleteDialog, AccountProxyDialog } from "../components/account-dialogs"
import { FingerprintDialog } from "../components/fingerprint-dialog"
import { Icon } from "../components/icon"
import type { PoolAccount, PoolProxy } from "../fixtures/pool-fixtures"
import { accountNetworkLabel } from "../models/claude-account-view"
import { AccountDetailScreen } from "./account-detail-screen"

/** 账号更新输入，字段与桌面桥一致；proxyId 为 null 表示解绑并改用系统网络。 */
export type ClaudeAccountUpdate = {
  accountId: string
  browserProfileId?: string
  displayName?: string
  enabled?: boolean
  proxyId?: string | null
  fingerprint?: ClaudeFingerprintView
}

/** 账号列表页面 props；accounts 和 proxies 来自 useClaudeAccounts。 */
export type AccountsScreenProps = {
  accounts: PoolAccount[]
  proxies: PoolProxy[]
  browserProfiles?: BrowserProfileView[] | undefined
  onOpenBrowserProfiles?: () => void
  onOpenAuthorize: () => void
  onReauthorize?: (accountId: string) => void
  onRemove?: (accountId: string) => void
  onUpdate?: (input: ClaudeAccountUpdate) => void
  /** 从 Claude CLI 导入账号；返回 false 表示失败，页面继续显示父组件传入的错误。 */
  onImportFromClaudeCli?: (browserProfileId?: string) => Promise<boolean>
  /** 最近一次账号操作的错误，例如删除时浏览器配置目录清理失败。 */
  error?: string | null
}

/** 绘制账号列表和账号详情。 */
export function AccountsScreen({
  accounts,
  proxies,
  browserProfiles,
  onOpenBrowserProfiles,
  onOpenAuthorize,
  onReauthorize,
  onRemove,
  onUpdate,
  onImportFromClaudeCli,
  error,
}: AccountsScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [proxyId, setProxyId] = useState<string | null>(null)
  const [fingerprintId, setFingerprintId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [imported, setImported] = useState(false)
  const [importing, setImporting] = useState(false)
  const [bindingAccountId, setBindingAccountId] = useState<string | null>(null)
  const [bindingProfileId, setBindingProfileId] = useState("")

  const selected = accounts.find((account) => account.id === selectedId) ?? null
  const attention = accounts.filter((account) => account.statusKind !== "ready")
  const ordered = accounts.filter((account) => account.statusKind === "ready")
  // 详情页和列表页共用这些弹层；详情页提前 return 时也要画出来，否则删除和更换按钮没有反应。
  const dialogs = (
    <>
      <AccountDeleteDialog
        open={deleteId !== null}
        accountName={
          accounts.find((account) => account.id === deleteId)?.name ??
          desktopText("pool.accounts-screen.fallbackAccount")
        }
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        onConfirm={() => {
          if (deleteId !== null) onRemove?.(deleteId)
          setDeleteId(null)
          setSelectedId(null)
        }}
      />
      <AccountProxyDialog
        open={proxyId !== null}
        accountName={
          accounts.find((account) => account.id === proxyId)?.name ??
          desktopText("pool.accounts-screen.account")
        }
        currentProxyId={accounts.find((account) => account.id === proxyId)?.proxyId ?? null}
        proxies={proxies}
        onOpenChange={(open) => {
          if (!open) setProxyId(null)
        }}
        onConfirm={(nextProxyId) => {
          if (proxyId !== null) onUpdate?.({ accountId: proxyId, proxyId: nextProxyId })
          setProxyId(null)
        }}
      />
      <FingerprintDialog
        open={fingerprintId !== null}
        account={accounts.find((account) => account.id === fingerprintId) ?? null}
        onOpenChange={(open) => {
          if (!open) setFingerprintId(null)
        }}
        onConfirm={(fingerprint) => {
          if (fingerprintId !== null) onUpdate?.({ accountId: fingerprintId, fingerprint })
          setFingerprintId(null)
        }}
      />
      <ClaudeCliImportDialog
        open={importOpen}
        profiles={browserProfiles}
        onOpenChange={setImportOpen}
        onConfirm={(profileId) => {
          if (importing) return
          setImportOpen(false)
          setImported(false)
          setImporting(true)
          const pending =
            (profileId ? onImportFromClaudeCli?.(profileId) : onImportFromClaudeCli?.()) ??
            Promise.resolve(false)
          void pending
            .then((ok) => {
              if (ok) setImported(true)
            })
            .catch(() => undefined)
            .finally(() => setImporting(false))
        }}
      />
      <Dialog
        open={bindingAccountId !== null}
        onOpenChange={(open) => {
          if (!open) setBindingAccountId(null)
        }}
      >
        <DialogContent>
          <div className="dialog-head">
            <DialogTitle>{desktopText("pool.accounts-screen.changeBrowserProfile")}</DialogTitle>
            <DialogDescription>
              {desktopText("pool.accounts-screen.changeBrowserProfileDescription")}
            </DialogDescription>
          </div>
          <div className="dialog-body">
            <BrowserProfileSelect
              id="account-browser-profile"
              profiles={browserProfiles ?? []}
              value={bindingProfileId}
              onChange={setBindingProfileId}
            />
          </div>
          <div className="dialog-foot">
            <Button variant="ghost" onClick={() => setBindingAccountId(null)}>
              {desktopText("pool.accounts-screen.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!bindingProfileId}
              onClick={() => {
                if (bindingAccountId)
                  onUpdate?.({ accountId: bindingAccountId, browserProfileId: bindingProfileId })
                setBindingAccountId(null)
              }}
            >
              {desktopText("pool.accounts-screen.saveBinding")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
  if (selected) {
    return (
      <>
        <AccountDetailScreen
          account={selected}
          browserProfileName={
            browserProfiles?.find((profile) => profile.id === selected.browserProfileId)?.name
          }
          onChangeBrowserProfile={() => {
            setBindingProfileId(selected.browserProfileId ?? "")
            setBindingAccountId(selected.id)
          }}
          onBack={() => setSelectedId(null)}
          onReauthorize={() => {
            // 先判断回调是否存在；回调返回 void，不能用 ?? 兜底，否则会同时打开添加向导并清掉账号 id。
            if (onReauthorize) onReauthorize(selected.id)
            else onOpenAuthorize()
          }}
          onDelete={() => setDeleteId(selected.id)}
          onToggleEnabled={() => onUpdate?.({ accountId: selected.id, enabled: !selected.enabled })}
          onChangeProxy={() =>
            selected.browserProfileId ? onOpenBrowserProfiles?.() : setProxyId(selected.id)
          }
          onEditFingerprint={() =>
            selected.browserProfileId ? onOpenBrowserProfiles?.() : setFingerprintId(selected.id)
          }
        />
        {dialogs}
      </>
    )
  }
  return (
    <SettingPage
      title={desktopText("pool.accounts-screen.title")}
      sub={desktopText("pool.accounts-screen.description")}
      actions={
        <>
          <Button
            variant="secondary"
            disabled={importing}
            aria-busy={importing}
            onClick={() => setImportOpen(true)}
          >
            {importing
              ? desktopText("pool.accounts-screen.importing")
              : desktopText("pool.accounts-screen.importCli")}
          </Button>
          <Button variant="primary" onClick={onOpenAuthorize}>
            {desktopText("pool.accounts-screen.add")}
          </Button>
        </>
      }
    >
      {imported ? (
        <p className="section-note" role="status">
          {desktopText("pool.accounts-screen.imported")}
        </p>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {accounts.length === 0 ? (
        <p className="section-note">{desktopText("pool.accounts-screen.empty")}</p>
      ) : null}
      {attention.length ? (
        <SettingSection title={desktopText("pool.accounts-screen.attention")}>
          {attention.map((account) => (
            <ListRow
              key={account.id}
              render={<button type="button" />}
              onClick={() => setSelectedId(account.id)}
              leading={<span className="pool-account-mark">{account.mark}</span>}
              title={account.name}
              description={
                <>
                  {account.status} · {accountNetworkLabel(account)}
                  {desktopText("pool.accounts-screen.excludedFromSwitching")}
                </>
              }
              meta={
                <>
                  <StatusDot tone={accountTone(account.statusKind)} />
                  {statusLabel(account.statusKind)}
                </>
              }
            />
          ))}
        </SettingSection>
      ) : null}
      <SettingSection
        title={desktopText("pool.accounts-screen.switchOrder")}
        actions={desktopText("pool.accounts-screen.savedOrder")}
      >
        {ordered.map((account) => (
          <ListRow
            key={account.id}
            render={<button type="button" />}
            onClick={() => setSelectedId(account.id)}
            leading={
              <>
                <Icon name="grip" className="pool-account-grip" />
                <span className="pool-account-mark">{account.mark}</span>
              </>
            }
            title={account.name}
            description={
              <>
                {account.status} · {accountNetworkLabel(account)}
              </>
            }
            meta={account.usage === null ? "—" : `${account.usage}%`}
            actions={<Icon name="right" small />}
          />
        ))}
      </SettingSection>
      {ordered.length === 0 && accounts.length > 0 ? (
        <p className="section-note">{desktopText("pool.accounts-screen.noEligibleAccounts")}</p>
      ) : null}
      <p className="section-note">{desktopText("pool.accounts-screen.switchLimits")}</p>
      {dialogs}
    </SettingPage>
  )
}

/** 从 Claude CLI 导入账号的确认弹层，说明复制范围、共享会话和 Keychain 弹窗。 */
function ClaudeCliImportDialog({
  open,
  profiles,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  profiles?: BrowserProfileView[] | undefined
  onOpenChange: (open: boolean) => void
  onConfirm: (profileId?: string) => void
}) {
  const [profileId, setProfileId] = useState("")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>{desktopText("pool.accounts-screen.importTitle")}</DialogTitle>
          <DialogDescription>
            {desktopText("pool.accounts-screen.importDescription")}
          </DialogDescription>
        </div>
        {profiles ? (
          <div className="dialog-body">
            <BrowserProfileSelect
              id="import-browser-profile"
              profiles={profiles}
              value={profileId}
              onChange={setProfileId}
            />
          </div>
        ) : null}
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {desktopText("pool.accounts-screen.cancelImport")}
          </Button>
          <Button
            variant="primary"
            disabled={profiles !== undefined && !profileId}
            onClick={() => onConfirm(profileId || undefined)}
          >
            {desktopText("pool.accounts-screen.confirmImport")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function statusLabel(kind: PoolAccount["statusKind"]): string {
  if (kind === "reauth") return desktopText("pool.accounts-screen.needsReauth")
  if (kind === "disabled") return desktopText("pool.accounts-screen.disabled")
  if (kind === "cooldown") return desktopText("pool.accounts-screen.cooldown")
  return desktopText("pool.accounts-screen.ready")
}

function accountTone(kind: PoolAccount["statusKind"]): StatusTone {
  if (kind === "reauth" || kind === "cooldown") return "warning"
  return kind === "ready" ? "ready" : "idle"
}
