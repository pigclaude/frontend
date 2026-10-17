// 负责在系统浏览器里展示设备授权确认，不加载桌面侧栏或凭据。
import { useEffect, useState } from "react"
import { Button } from "./components/ui/button"
import { Icon } from "./components/icon"

/** 浏览器授权页的确认状态。 */
export function AuthorizeWeb() {
  const [approved, setApproved] = useState(false)
  useEffect(() => {
    void fetch("/authorize/status")
      .then((response) => response.json() as Promise<{ approved?: boolean }>)
      .then((body) => setApproved(Boolean(body.approved)))
      .catch(() => undefined)
  }, [])

  async function approve() {
    await fetch("/authorize/approve", { method: "POST" }).catch(() => undefined)
    setApproved(true)
  }

  return (
    <main className="web-auth">
      <div className="mark" aria-hidden="true">
        <Icon name="snout" />
      </div>
      <h1>{approved ? "已确认授权" : "确认登录 pigclaude"}</h1>
      <p className="sub">{approved ? "可以回到桌面端继续。" : "请确认这是你正在使用的设备。"}</p>
      <div className="kv">
        <div>
          <span>账户</span>
          <b>林舟 · lin•••@example.com</b>
        </div>
        <div>
          <span>设备</span>
          <b>MacBook Pro · 当前设备</b>
        </div>
        <div>
          <span>出口</span>
          <b className="mono">203.0.113.42 · LA-01</b>
        </div>
      </div>
      {!approved ? (
        <Button variant="primary" size="lg" onClick={() => void approve()}>
          确认授权
        </Button>
      ) : (
        <Icon name="check" />
      )}
    </main>
  )
}
