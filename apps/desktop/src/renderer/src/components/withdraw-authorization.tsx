// 提供共享撤销确认：恢复页从更多操作进入，目标与确认由 main 准备，取消不发撤销请求。
import { useEffect, useRef, useState } from "react"
import type { DeviceWithdrawalConfirmation } from "@pigclaude/contracts/desktop-membership"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu"
/** 所有入口共享确认保护，只传界面关联和 main 生成的确认，不自报用户或设备。 */
export function WithdrawAuthorization({
  contextId,
  more = false,
}: {
  contextId?: string | undefined
  more?: boolean
}) {
  const [confirmation, setConfirmation] = useState<{
    contextId: string
    value: DeviceWithdrawalConfirmation
  } | null>(null)
  const [phase, setPhase] = useState<"idle" | "preparing" | "submitting">("idle")
  const [error, setError] = useState<string | null>(null)
  const operation = useRef<symbol | null>(null)
  const latestContext = useRef(contextId)
  latestContext.current = contextId
  useEffect(() => {
    operation.current = null
    setPhase("idle")
    setError(null)
    setConfirmation(null)
    return () => {
      operation.current = null
    }
  }, [contextId])
  const current = confirmation?.contextId === contextId ? confirmation?.value : undefined
  async function prepare() {
    if (operation.current) return
    const action = window.pigclaude?.membership?.prepareWithdrawal
    if (!contextId || !action) {
      setError("当前授权尚未核验，请重新检查后再试。")
      return
    }
    const id = Symbol()
    operation.current = id
    setPhase("preparing")
    setError(null)
    try {
      const value = await action(contextId)
      if (operation.current === id && latestContext.current === contextId)
        setConfirmation({ contextId, value })
    } catch {
      if (operation.current === id) setError("无法确认当前授权或缺少撤销权限，请重新检查后再试。")
    } finally {
      if (operation.current === id) {
        operation.current = null
        setPhase("idle")
      }
    }
  }
  async function submit() {
    if (!current || operation.current) return
    const id = Symbol()
    operation.current = id
    setPhase("submitting")
    setError(null)
    try {
      const action = window.pigclaude?.membership?.withdraw
      if (!action) throw new Error("unavailable")
      const result = await action(current.confirmationId)
      if (result.state !== "signed_out") throw new Error("not completed")
      if (operation.current === id) setConfirmation(null)
    } catch {
      if (operation.current === id) {
        setConfirmation(null)
        setError("撤销未完成或授权状态已变化，请重新检查后再试。")
      }
    } finally {
      if (operation.current === id) {
        operation.current = null
        setPhase("idle")
      }
    }
  }
  return (
    <div>
      {more ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={phase !== "idle"}
              aria-busy={phase === "preparing"}
            >
              {phase === "preparing" ? "正在确认…" : "更多操作"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => void prepare()}>撤销本机授权</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button disabled={phase !== "idle"} onClick={() => void prepare()}>
          {phase === "preparing" ? "正在确认…" : "撤销本机授权"}
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      <Dialog
        open={Boolean(current)}
        onOpenChange={(open) => {
          if (!open && phase !== "submitting") setConfirmation(null)
        }}
      >
        <DialogContent className="withdrawal-dialog">
          <div className="dialog-head">
            <DialogTitle>撤销本机授权？</DialogTitle>
          </div>
          <div className="dialog-body">
            <DialogDescription>
              将撤销当前网站账号在这台设备上的全部相关桌面授权。
            </DialogDescription>
            {current && (
              <p>
                {current.account.nickname && <strong>{current.account.nickname} </strong>}
                {current.account.email}
              </p>
            )}
            <p>
              其他设备、同机其他网站账号、网站登录会话，以及本地 Claude
              账号、凭据、代理和指纹均保留。
            </p>
          </div>
          <div className="dialog-foot">
            <Button disabled={phase === "submitting"} onClick={() => setConfirmation(null)}>
              取消
            </Button>
            <Button
              variant="solidDanger"
              disabled={phase === "submitting"}
              onClick={() => void submit()}
            >
              {phase === "submitting" ? "正在撤销…" : "确认撤销"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
