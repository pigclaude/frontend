// 负责代理池列表：真实新增/编辑/删除、单个和全部连通性测试、未测试状态和操作错误。

import { useState } from "react"
import { Button } from "../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"
import { AddProxyDialog } from "../components/proxy-dialogs"
import type { PoolProxy } from "../fixtures/pool-fixtures"

/** 代理列表页面 props；数据来自 useClaudeAccounts。 */
export type ProxiesScreenProps = {
  proxies: PoolProxy[]
  onTest?: (proxyId: string) => Promise<void> | void
  onSave?: (input: { id?: string; name: string; url: string }) => Promise<void> | void
  onRemove?: (proxyId: string) => Promise<void> | void
  onOpenProxy?: (proxy: PoolProxy) => void
  /** 最近一次代理操作的错误，例如地址不是 HTTP/HTTPS。 */
  error?: string | null
}

/** 绘制代理列表、编辑弹层和删除确认。 */
export function ProxiesScreen({
  proxies,
  onTest,
  onSave,
  onRemove,
  onOpenProxy,
  error,
}: ProxiesScreenProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<PoolProxy | null>(null)
  const [deleting, setDeleting] = useState<PoolProxy | null>(null)
  const [testingAll, setTestingAll] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  async function testOne(proxyId: string): Promise<void> {
    if (onTest === undefined) return
    setTestingId(proxyId)
    try {
      await onTest(proxyId)
    } finally {
      setTestingId(null)
    }
  }

  async function testAll(): Promise<void> {
    if (onTest === undefined) return
    setTestingAll(true)
    try {
      await Promise.allSettled(proxies.map((proxy) => onTest(proxy.id)))
    } finally {
      setTestingAll(false)
    }
  }

  function closeProxyDialog(open: boolean): void {
    if (!open) {
      setAddOpen(false)
      setEditing(null)
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>代理</h1>
          <p className="sub">代理可选；未绑定代理的账号使用系统网络；已绑定代理的请求不会直连</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={() => void testAll()} disabled={testingAll}>
            {testingAll ? "测试中…" : "全部测试"}
          </Button>
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            添加代理
          </Button>
        </div>
      </header>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {proxies.length === 0 ? (
        <p className="note">
          还没有代理。代理可选；未绑定代理的账号使用系统网络。添加一个出口固定的 HTTP/HTTPS
          代理，给需要固定出口的账号使用。
        </p>
      ) : null}
      <div className="group">
        {proxies.map((proxy) => (
          <div className="item" key={proxy.id}>
            <Button
              variant="plain"
              className="main"
              type="button"
              onClick={() => onOpenProxy?.(proxy)}
            >
              <span className="ttl">{proxy.name}</span>
              <span className="desc">
                {proxy.exit} · {proxy.region}
              </span>
            </Button>
            <span className="trail">
              <span className={proxy.available ? "status ok" : "status bad"}>
                {proxy.available ? `${proxy.latency} ms` : "未通过测试"}
              </span>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`测试 ${proxy.name}`}
                disabled={testingId !== null}
                onClick={() => void testOne(proxy.id)}
              >
                {testingId === proxy.id ? "测试中…" : "测试"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`编辑 ${proxy.name}`}
                onClick={() => setEditing(proxy)}
              >
                编辑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`删除 ${proxy.name}`}
                onClick={() => setDeleting(proxy)}
              >
                删除
              </Button>
            </span>
          </div>
        ))}
      </div>
      <p className="note">
        已绑定代理的请求不会直连：代理不可用时以 503 结束，不会回退到本机网络。
      </p>
      <AddProxyDialog
        open={addOpen || editing !== null}
        editing={editing === null ? null : { id: editing.id, name: editing.name }}
        onOpenChange={closeProxyDialog}
        onConfirm={(url, name) => {
          if (editing === null) onSave?.({ name, url })
          else onSave?.({ id: editing.id, name, url })
          setAddOpen(false)
          setEditing(null)
        }}
      />
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <DialogContent>
          <div className="dialog-head">
            <DialogTitle>删除代理「{deleting?.name ?? ""}」？</DialogTitle>
            <DialogDescription>
              删除后，绑定它的账号会因找不到代理而不可用，已保存的登录不会自动失效。
            </DialogDescription>
          </div>
          <div className="dialog-foot">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleting !== null) onRemove?.(deleting.id)
                setDeleting(null)
              }}
            >
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
