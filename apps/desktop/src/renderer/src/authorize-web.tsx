// 负责在系统浏览器里展示设备授权确认，不加载桌面侧栏或凭据。
import { useMemo, useState } from "react"
import { Button } from "./components/ui/button"
import { Icon } from "./components/icon"

/** 浏览器授权页的确认状态。 */
export function AuthorizeWeb() {
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const mode = params.get("mode")
  const purpose = params.get("purpose")
  const register = mode === "register"
  const claudeAccount = purpose === "claude-account"
  const title = approved
    ? "已确认授权"
    : register
      ? "注册并授权 pigclaude"
      : claudeAccount
        ? "确认添加 Claude 账号"
        : "确认登录 pigclaude"
  const description = approved
    ? "可以返回桌面端继续。"
    : claudeAccount
      ? "请确认将这个 Claude 账号加入当前设备的号池。"
      : register
        ? "请在当前浏览器创建 pigclaude 账户并授权这台设备。"
        : "请确认这是你正在使用的设备。"

  async function approve() {
    setError(null)
    try {
      const response = await fetch("/authorize/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: params.get("session_id"),
          state: params.get("state"),
        }),
      })
      const body = (await response.json()) as { redirectUrl?: string; error?: string }
      if (!response.ok || !body.redirectUrl) throw new Error(body.error ?? "授权请求失败")
      setApproved(true)
      window.location.assign(body.redirectUrl)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "授权请求失败")
    }
  }

  return (
    <main className="web-auth">
      <div className="mark" aria-hidden="true">
        <Icon name="snout" />
      </div>
      <h1>{title}</h1>
      <p className="sub">{description}</p>
      <div className="kv">
        <div>
          <span>账户</span>
          <b>{params.get("account_name") ?? "林舟 · lin•••@example.com"}</b>
        </div>
        <div>
          <span>设备</span>
          <b>MacBook Pro · 当前设备</b>
        </div>
        <div>
          <span>{claudeAccount ? "授权范围" : "授权用途"}</span>
          <b className="mono">
            {claudeAccount
              ? "读取账号 · 加入号池"
              : register
                ? "创建账户 · 使用 pigclaude"
                : "使用 pigclaude"}
          </b>
        </div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {!approved ? (
        <Button variant="primary" size="lg" onClick={() => void approve()}>
          {register ? "注册并授权" : claudeAccount ? "确认添加" : "确认登录"}
        </Button>
      ) : (
        <Icon name="check" />
      )}
    </main>
  )
}
