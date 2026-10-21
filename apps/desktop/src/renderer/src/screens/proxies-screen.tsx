// 负责代理池列表、测试、详情和账号绑定入口。
import { useEffect, useState } from "react"
import { Button } from "../components/ui/button"
import { AddProxyDialog } from "../components/proxy-dialogs"
import type { PoolProxy } from "../fixtures/pool-fixtures"

/** 代理列表页面 props。 */
export type ProxiesScreenProps = {
  proxies: PoolProxy[]
  onTest?: (proxyId: string) => Promise<void> | void
  onSave?: (input: { name: string; url: string }) => Promise<void> | void
  onOpenProxy?: (proxy: PoolProxy) => void
  /** 最近一次代理操作的错误，例如地址不是 HTTP/HTTPS。 */
  error?: string | null
}

/** 绘制代理列表和添加代理弹层。 */
export function ProxiesScreen({ proxies, onTest, onSave, onOpenProxy, error }: ProxiesScreenProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [rows, setRows] = useState(proxies)

  useEffect(() => {
    setRows(proxies)
  }, [proxies])

  async function testAll() {
    if (onTest === undefined) return
    setTesting(true)
    try {
      await Promise.allSettled(rows.map((proxy) => onTest(proxy.id)))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>代理</h1>
          <p className="sub">每个账号绑定一个代理，登录和对话都只走它</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={() => void testAll()} disabled={testing}>
            {testing ? "测试中…" : "全部测试"}
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
      {rows.length === 0 ? (
        <p className="note">还没有代理。添加一个出口固定的 HTTP/HTTPS 代理后再授权账号。</p>
      ) : null}
      <div className="group">
        {rows.map((proxy) => (
          <Button
            variant="plain"
            className="item"
            type="button"
            key={proxy.id}
            onClick={() => onOpenProxy?.(proxy)}
          >
            <div className="main">
              <div className="ttl">{proxy.name}</div>
              <div className="desc">
                {proxy.exit} · {proxy.region}
              </div>
            </div>
            <span className="trail">
              <span className="avatar sm">
                {proxy.accountId ? proxy.accountId.slice(0, 1) : "—"}
              </span>
              <span className={proxy.available ? "status ok" : "status bad"}>
                {proxy.available ? `${proxy.latency} ms` : "未通过测试"}
              </span>
              <span className="chev">›</span>
            </span>
          </Button>
        ))}
      </div>
      <p className="note">代理不可用时请求以 503 结束，不会从本机网络直接发出。</p>
      <AddProxyDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onConfirm={(url, name) => {
          if (onSave !== undefined) {
            void onSave({ name, url })
          } else {
            setRows((current) => [
              ...current,
              {
                id: name.toLowerCase(),
                name,
                exit: "待检测",
                region: "待检测",
                latency: 0,
                accountId: null,
                available: false,
              },
            ])
          }
          setAddOpen(false)
        }}
      />
    </div>
  )
}
