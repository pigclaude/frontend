// 负责展示 Claude 账号列表、自动切换顺序和账号详情入口。
import { useState } from "react"
import { Button } from "../components/ui/button"
import {
  AccountDeleteDialog,
  AccountProxyDialog,
  FingerprintDialog,
} from "../components/account-dialogs"
import { accountFixtures, proxyFixtures } from "../fixtures/renderer-fixtures"
import type { PoolAccount, PoolProxy } from "../fixtures/pool-fixtures"
import { AccountDetailScreen } from "./account-detail-screen"

/** 账号列表页面 props。 */
export type AccountsScreenProps = {
  accounts?: PoolAccount[]
  proxies?: PoolProxy[]
  onOpenAuthorize: () => void
}

/** 绘制账号列表和账号详情。 */
export function AccountsScreen({
  accounts = toPoolAccounts(),
  proxies = toPoolProxies(),
  onOpenAuthorize,
}: AccountsScreenProps) {
  const [items, setItems] = useState(accounts)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [proxyId, setProxyId] = useState<string | null>(null)
  const [fingerprintId, setFingerprintId] = useState<string | null>(null)
  const selected = items.find((account) => account.id === selectedId) ?? null
  if (selected) {
    return (
      <AccountDetailScreen
        account={selected}
        onBack={() => setSelectedId(null)}
        onReauthorize={onOpenAuthorize}
        onDelete={() => setDeleteId(selected.id)}
        onChangeProxy={() => setProxyId(selected.id)}
        onEditFingerprint={() => setFingerprintId(selected.id)}
      />
    )
  }
  const attention = items.filter((account) => !account.autoSwitch)
  const ordered = items.filter((account) => account.autoSwitch)
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Claude 账号</h1>
          <p className="sub">需要处理的事、自动切换顺序</p>
        </div>
        <Button variant="primary" onClick={onOpenAuthorize}>
          添加账号
        </Button>
      </header>
      {attention.length ? (
        <section className="section">
          <div className="section-head">
            <h2>需要处理</h2>
          </div>
          <div className="group">
            {attention.map((account) => (
              <button
                className="item"
                type="button"
                key={account.id}
                onClick={() => setSelectedId(account.id)}
              >
                <span className="avatar">{account.mark}</span>
                <div className="main">
                  <div className="ttl">{account.name}</div>
                  <div className="desc">{account.status} · 不参与自动切换</div>
                </div>
                <span className="status info">需重新授权</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section className="section">
        <div className="section-head">
          <h2>自动切换顺序</h2>
          <span className="end">拖动调整</span>
        </div>
        <div className="group">
          {ordered.map((account) => (
            <button
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
                <div className="desc">{account.status}</div>
                <div className="meter">
                  <span className={account.usage === 100 ? "bar is-full" : "bar"}>
                    <i style={{ width: `${account.usage ?? 0}%` }} />
                  </span>
                  <span className="num">{account.usage}%</span>
                </div>
              </div>
              <span className="chev">
                <span>›</span>
              </span>
            </button>
          ))}
        </div>
        <p className="note">响应体开始写出后不再换号；请求体超过 32 MiB 不重放。</p>
      </section>
      <AccountDeleteDialog
        open={deleteId !== null}
        accountName={items.find((account) => account.id === deleteId)?.name ?? "这个账号"}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        onConfirm={() => {
          setItems((current) => current.filter((account) => account.id !== deleteId))
          setDeleteId(null)
          setSelectedId(null)
        }}
      />
      <AccountProxyDialog
        open={proxyId !== null}
        accountName={items.find((account) => account.id === proxyId)?.name ?? "账号"}
        proxies={proxies}
        onOpenChange={(open) => {
          if (!open) setProxyId(null)
        }}
        onConfirm={(nextProxyId) => {
          setItems((current) =>
            current.map((account) =>
              account.id === proxyId ? { ...account, proxyId: nextProxyId } : account,
            ),
          )
          setProxyId(null)
        }}
      />
      <FingerprintDialog
        open={fingerprintId !== null}
        account={items.find((account) => account.id === fingerprintId) ?? null}
        onOpenChange={(open) => {
          if (!open) setFingerprintId(null)
        }}
        onConfirm={(fingerprint) => {
          setItems((current) =>
            current.map((account) =>
              account.id === fingerprintId ? { ...account, fingerprint } : account,
            ),
          )
          setFingerprintId(null)
        }}
      />
    </div>
  )
}

function toPoolAccounts(): PoolAccount[] {
  return accountFixtures.map((account) => ({
    ...account,
    proxyId: account.id === "primary" ? "la-01" : null,
    fingerprint: `fp_${account.id}…73aa`,
  }))
}

function toPoolProxies(): PoolProxy[] {
  return proxyFixtures.map((proxy) => ({ ...proxy, accountId: proxy.accountId ?? null }))
}
