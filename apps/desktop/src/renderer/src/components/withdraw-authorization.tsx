// 提供共享撤销确认：恢复页从更多操作进入，目标与确认由 main 准备，取消不发撤销请求。
import { desktopText } from "../locale/text"
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
      setError(desktopText("flows.withdraw-authorization.1"))
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
      if (operation.current === id) setError(desktopText("flows.withdraw-authorization.2"))
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
        setError(desktopText("flows.withdraw-authorization.3"))
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
              {phase === "preparing"
                ? desktopText("flows.withdraw-authorization.4")
                : desktopText("flows.withdraw-authorization.5")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => void prepare()}>
              {desktopText("flows.withdraw-authorization.6")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button disabled={phase !== "idle"} onClick={() => void prepare()}>
          {phase === "preparing"
            ? desktopText("flows.withdraw-authorization.7")
            : desktopText("flows.withdraw-authorization.8")}
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
            <DialogTitle>{desktopText("flows.withdraw-authorization.9")}</DialogTitle>
          </div>
          <div className="dialog-body">
            <DialogDescription>{desktopText("flows.withdraw-authorization.10")}</DialogDescription>
            {current && (
              <p>
                {current.account.nickname && <strong>{current.account.nickname} </strong>}
                {current.account.email}
              </p>
            )}
            <p>{desktopText("flows.withdraw-authorization.11")}</p>
          </div>
          <div className="dialog-foot">
            <Button disabled={phase === "submitting"} onClick={() => setConfirmation(null)}>
              {desktopText("flows.withdraw-authorization.12")}
            </Button>
            <Button
              variant="solidDanger"
              disabled={phase === "submitting"}
              onClick={() => void submit()}
            >
              {phase === "submitting"
                ? desktopText("flows.withdraw-authorization.13")
                : desktopText("flows.withdraw-authorization.14")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
