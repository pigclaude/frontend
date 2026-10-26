// 负责展示真实 Claude 账号列表：需要处理（重新授权/停用/冷却）、自动切换顺序和账号详情入口。

import { useState } from "react"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { Button } from "../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"
import { AccountDeleteDialog, AccountProxyDialog } from "../components/account-dialogs"
import { FingerprintDialog } from "../components/fingerprint-dialog"
import type { PoolAccount, PoolProxy } from "../fixtures/pool-fixtures"
import { accountNetworkLabel } from "../models/claude-account-view"
import { AccountDetailScreen } from "./account-detail-screen"

/** 账号更新输入，字段与桌面桥一致；proxyId 为 null 表示解绑并改用系统网络。 */
export type ClaudeAccountUpdate = {
  accountId: string
  displayName?: string
  enabled?: boolean
  proxyId?: string | null
  fingerprint?: ClaudeFingerprintView
}

/** 账号列表页面 props；accounts 和 proxies 来自 useClaudeAccounts。 */
export type AccountsScreenProps = {
  accounts: PoolAccount[]
  proxies: PoolProxy[]
  onOpenAuthorize: () => void
  onReauthorize?: (accountId: string) => void
  onRemove?: (accountId: string) => void
  onUpdate?: (input: ClaudeAccountUpdate) => void
  /** 从 Claude CLI 导入账号；返回 false 表示失败，页面继续显示父组件传入的错误。 */
  onImportFromClaudeCli?: () => Promise<boolean>
  /** 最近一次账号操作的错误，例如删除时浏览器配置目录清理失败。 */
  error?: string | null
}

/** 绘制账号列表和账号详情。 */
export function AccountsScreen({
  accounts,
  proxies,
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

  const selected = accounts.find((account) => account.id === selectedId) ?? null
  const attention = accounts.filter((account) => account.statusKind !== "ready")
  const ordered = accounts.filter((account) => account.statusKind === "ready")
  // 详情页和列表页共用这些弹层；详情页提前 return 时也要画出来，否则删除和更换按钮没有反应。
  const dialogs = (
    <>
      <AccountDeleteDialog
        open={deleteId !== null}
        accountName={accounts.find((account) => account.id === deleteId)?.name ?? "这个账号"}
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
        accountName={accounts.find((account) => account.id === proxyId)?.name ?? "账号"}
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
        onOpenChange={setImportOpen}
        onConfirm={() => {
          if (importing) return
          setImportOpen(false)
          setImported(false)
          setImporting(true)
          const pending = onImportFromClaudeCli?.() ?? Promise.resolve(false)
          void pending
            .then((ok) => {
              if (ok) setImported(true)
            })
            .catch(() => undefined)
            .finally(() => setImporting(false))
        }}
      />
    </>
  )
  if (selected) {
    return (
      <>
        <AccountDetailScreen
          account={selected}
          onBack={() => setSelectedId(null)}
          onReauthorize={() => onReauthorize?.(selected.id) ?? onOpenAuthorize()}
          onDelete={() => setDeleteId(selected.id)}
          onToggleEnabled={() => onUpdate?.({ accountId: selected.id, enabled: !selected.enabled })}
          onChangeProxy={() => setProxyId(selected.id)}
          onEditFingerprint={() => setFingerprintId(selected.id)}
        />
        {dialogs}
      </>
    )
  }
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Claude 账号</h1>
          <p className="sub">需要处理的事、自动切换顺序</p>
        </div>
        <div className="actions">
          <Button
            variant="secondary"
            disabled={importing}
            aria-busy={importing}
            onClick={() => setImportOpen(true)}
          >
            {importing ? "正在导入…" : "从 Claude CLI 导入"}
          </Button>
          <Button variant="primary" onClick={onOpenAuthorize}>
            添加账号
          </Button>
        </div>
      </header>
      {imported ? (
        <p className="note" role="status">
          已从 Claude CLI 导入账号
        </p>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {accounts.length === 0 ? (
        <p className="note">还没有 Claude 账号。添加后会在这里显示授权状态和切换顺序。</p>
      ) : null}
      {attention.length ? (
        <section className="section">
          <div className="section-head">
            <h2>需要处理</h2>
          </div>
          <div className="group">
            {attention.map((account) => (
              <Button
                variant="plain"
                className="item"
                type="button"
                key={account.id}
                onClick={() => setSelectedId(account.id)}
              >
                <span className="avatar">{account.mark}</span>
                <div className="main">
                  <div className="ttl">{account.name}</div>
                  <div className="desc">
                    {account.status} · {accountNetworkLabel(account)} · 不参与自动切换
                  </div>
                </div>
                <span className={statusClass(account.statusKind)}>
                  {statusLabel(account.statusKind)}
                </span>
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      <section className="section">
        <div className="section-head">
          <h2>自动切换顺序</h2>
          <span className="end">按保存顺序</span>
        </div>
        <div className="group">
          {ordered.map((account) => (
            <Button
              variant="plain"
              className="item"
              type="button"
              key={account.id}
              onClick={() => setSelectedId(account.id)}
            >
              <span className="grip">
                <span>⋮</span>
              </span>
              <span className="avatar">{account.mark}</span>
              <div className="main">
                <div className="ttl">{account.name}</div>
                <div className="desc">
                  {account.status} · {accountNetworkLabel(account)}
                </div>
                <div className="meter">
                  <span className={account.usage === 100 ? "bar is-full" : "bar"}>
                    <i style={{ width: `${account.usage ?? 0}%` }} />
                  </span>
                  <span className="num">{account.usage === null ? "—" : `${account.usage}%`}</span>
                </div>
              </div>
              <span className="chev">
                <span>›</span>
              </span>
            </Button>
          ))}
        </div>
        {ordered.length === 0 && accounts.length > 0 ? (
          <p className="note">没有可用账号；处理上面的账号后会自动回到切换顺序。</p>
        ) : null}
        <p className="note">响应体开始写出后不再换号；请求体超过 32 MiB 不重放。</p>
      </section>
      {dialogs}
    </div>
  )
}

/** 从 Claude CLI 导入账号的确认弹层，说明复制范围、共享会话和 Keychain 弹窗。 */
function ClaudeCliImportDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>从 Claude CLI 导入账号？</DialogTitle>
          <DialogDescription>
            将读取并复制 macOS 钥匙串中的 Claude CLI OAuth 凭据到本机账号库。原 CLI
            凭据不会删除，两个应用共享同一登录会话。读取时 Keychain 可能弹窗，显示
            security。导入后的账号默认使用系统网络和默认指纹。
          </DialogDescription>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            确认导入
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function statusLabel(kind: PoolAccount["statusKind"]): string {
  if (kind === "reauth") return "需重新授权"
  if (kind === "disabled") return "已停用"
  if (kind === "cooldown") return "冷却中"
  return "可用"
}

function statusClass(kind: PoolAccount["statusKind"]): string {
  if (kind === "cooldown") return "status warn"
  if (kind === "ready") return "status ok"
  return "status info"
}
