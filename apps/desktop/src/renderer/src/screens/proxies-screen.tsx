// 负责代理池列表、测试、详情和账号绑定入口。
import { useState } from "react"
import { Button } from "../components/ui/button"
import { AddProxyDialog } from "../components/proxy-dialogs"
import type { PoolProxy } from "../fixtures/pool-fixtures"

/** 代理列表页面 props。 */
export type ProxiesScreenProps = {
  proxies: PoolProxy[]
  onTestAll?: () => void
  onAdd?: (url: string, name: string) => void
  onOpenProxy?: (proxy: PoolProxy) => void
}

/** 绘制代理列表和添加代理弹层。 */
export function ProxiesScreen({ proxies, onTestAll, onAdd, onOpenProxy }: ProxiesScreenProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [rows, setRows] = useState(proxies)
  function testAll() {
    setTesting(true)
    onTestAll?.()
    window.setTimeout(() => setTesting(false), 700)
  }
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>代理</h1>
          <p className="sub">每个账号绑定一个代理，登录和对话都只走它</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={testAll} disabled={testing}>
            {testing ? "测试中…" : "全部测试"}
          </Button>
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            添加代理
          </Button>
        </div>
      </header>
      <div className="group">
        {rows.map((proxy) => (
          <button
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
                {proxy.available ? `${proxy.latency} ms` : "连接超时"}
              </span>
              <span className="chev">›</span>
            </span>
          </button>
        ))}
      </div>
      <p className="note">代理不可用时请求以 503 结束，不会从本机网络直接发出。</p>
      <AddProxyDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onConfirm={(url, name) => {
          onAdd?.(url, name)
          setRows((current) => [
            ...current,
            {
              id: name.toLowerCase(),
              name,
              exit: "203.0.113.99",
              region: "待检测",
              latency: 0,
              accountId: null,
              available: false,
            },
          ])
          setAddOpen(false)
        }}
      />
    </div>
  )
}
