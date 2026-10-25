// 负责设备私有名称表单与精确目标核验对话框；敏感材料不进入查询或 mutation 缓存。
"use client"
import { useState } from "react"
import type { UserDeviceView } from "@pigclaude/contracts/user-devices"
import type { LinkedIdentity } from "@pigclaude/api/home/identity"
import { Button } from "@pigclaude/web-ui/components/button"
import { Input } from "@pigclaude/web-ui/components/input"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@pigclaude/web-ui/components/dialog"
import { RecentAuthDialog } from "../identity/recent-auth-dialog"
/** 所选设备是服务器快照，始终带原关系 epoch。 */
export type DeviceAction = { type: "rename" | "revoke"; device: UserDeviceView } | { type: "all" }
/** 动作交给父级 owner，在每个异步边界检查是否仍属当前页面。 */
export function DeviceActions({
  action,
  identities,
  hasPassword,
  pending,
  error,
  run,
  execute,
  close,
}: {
  action: DeviceAction
  identities: LinkedIdentity[]
  hasPassword?: boolean
  pending: boolean
  error: string | null
  run: (request: (isCurrent: () => boolean) => Promise<void>) => void
  execute: (isCurrent: () => boolean, name?: string) => Promise<void>
  close: () => void
}) {
  const [name, setName] = useState(action.type === "rename" ? action.device.displayName : "")
  if (action.type !== "rename")
    return (
      <RecentAuthDialog
        action={
          action.type === "all"
            ? { operation: "revoke_all_devices" }
            : {
                operation: "revoke_device",
                device_id: action.device.deviceId,
                expected_binding_epoch: action.device.bindingEpoch,
              }
        }
        identities={identities}
        hasPassword={hasPassword}
        pending={pending}
        error={error}
        onRun={run}
        onVerified={execute}
        onClose={close}
      />
    )
  const valid = [...name].length >= 1 && [...name].length <= 64 && !/\p{Cc}/u.test(name)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close()
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogTitle>重命名这台电脑</DialogTitle>
        <DialogDescription>名称仅对当前账号可见，不影响共享设备上的其他账号。</DialogDescription>
        {error && (
          <p role="alert" className="query-error">
            {error}
          </p>
        )}
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid && !pending) run((owner) => execute(owner, name))
          }}
        >
          <label htmlFor="device-name">设备名称</label>
          <Input id="device-name" value={name} onChange={(event) => setName(event.target.value)} />
          <p className="text-sm text-muted-foreground">1–64 个字符，不含控制字符。</p>
          <Button type="submit" disabled={pending || !valid}>
            保存
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={close}>
            取消
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
