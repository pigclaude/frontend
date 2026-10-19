// 负责单独展示当前设备关系撤销操作，会员失效时仍可请求主进程验证。
import { useState } from "react"
import { Button } from "./ui/button"

/** 撤销始终由 main 捕获当前身份，renderer 不传 token 或设备标识。 */
export function WithdrawAuthorization() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function withdraw(): Promise<void> {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const action = window.pigclaude?.membership?.withdraw
      if (!action) throw new Error("unavailable")
      await action()
    } catch {
      setError("撤销未完成，请连接服务后重试。")
    } finally {
      setPending(false)
    }
  }
  return (
    <div>
      <Button disabled={pending} onClick={() => void withdraw()}>
        {pending ? "正在撤销…" : "撤销本机授权"}
      </Button>
      <p>撤销当前账号在本机的全部 profile 授权。</p>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
