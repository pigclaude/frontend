// 负责代理池列表：真实新增/编辑/删除、单个和全部连通性测试、未测试状态和操作错误。

import { desktopText } from "../locale/text"
import { useState } from "react"
import { ListRow, SettingPage, SettingSection, StatusDot } from "@pigclaude/ui-primitives"
import { Button } from "../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"
import { AddProxyDialog } from "../components/proxy-dialogs"
import type { PoolProxy } from "../fixtures/pool-fixtures"
import { proxyDescription, proxyStatus, proxyStatusTone } from "../models/claude-account-view"

/** 代理列表页面 props；数据来自 useClaudeAccounts。 */
export type ProxiesScreenProps = {
  proxies: PoolProxy[]
  onTest?: (proxyId: string) => Promise<void> | void
  onSave?: (input: { id?: string; name: string; url: string }) => Promise<void> | void
  onRemove?: (proxyId: string) => Promise<void> | void
  /** 最近一次代理操作的错误，例如地址不是 HTTP/HTTPS。 */
  error?: string | null
}

/** 绘制代理列表、编辑弹层和删除确认。 */
export function ProxiesScreen({ proxies, onTest, onSave, onRemove, error }: ProxiesScreenProps) {
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
    <SettingPage
      title={desktopText("pool.proxies-screen.title")}
      sub={desktopText("pool.proxies-screen.description")}
      actions={
        <>
          <Button variant="secondary" onClick={() => void testAll()} disabled={testingAll}>
            {testingAll
              ? desktopText("pool.proxies-screen.testingAll")
              : desktopText("pool.proxies-screen.testAll")}
          </Button>
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            {desktopText("pool.proxies-screen.add")}
          </Button>
        </>
      }
    >
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {proxies.length === 0 ? (
        <p className="section-note">{desktopText("pool.proxies-screen.empty")}</p>
      ) : null}
      <SettingSection>
        {proxies.map((proxy) => (
          <ListRow
            key={proxy.id}
            title={proxy.name}
            description={proxyDescription(proxy)}
            meta={
              <>
                <StatusDot tone={proxyStatusTone(proxy)} />
                {proxyStatus(proxy).label}
              </>
            }
            actions={
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={desktopText("pool.proxies-screen.testNamed", {
                    value1: String(proxy.name),
                  })}
                  disabled={testingId !== null}
                  onClick={() => void testOne(proxy.id)}
                >
                  {testingId === proxy.id
                    ? desktopText("pool.proxies-screen.testing")
                    : desktopText("pool.proxies-screen.test")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={desktopText("pool.proxies-screen.editNamed", {
                    value1: String(proxy.name),
                  })}
                  onClick={() => setEditing(proxy)}
                >
                  {desktopText("pool.proxies-screen.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={desktopText("pool.proxies-screen.deleteNamed", {
                    value1: String(proxy.name),
                  })}
                  onClick={() => setDeleting(proxy)}
                >
                  {desktopText("pool.proxies-screen.delete")}
                </Button>
              </>
            }
          />
        ))}
      </SettingSection>
      <p className="section-note">{desktopText("pool.proxies-screen.noFallback")}</p>
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
            <DialogTitle>
              {desktopText("pool.proxies-screen.deletePrefix")}
              {deleting?.name ?? ""}」？
            </DialogTitle>
            <DialogDescription>
              {desktopText("pool.proxies-screen.deleteDescription")}
            </DialogDescription>
          </div>
          <div className="dialog-foot">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {desktopText("pool.proxies-screen.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleting !== null) onRemove?.(deleting.id)
                setDeleting(null)
              }}
            >
              {desktopText("pool.proxies-screen.confirmDelete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingPage>
  )
}
