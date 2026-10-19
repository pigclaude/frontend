// 负责迁入成熟后台的devices-section布局和交互，使用本项目真实 API。
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MembershipDeviceItem } from "@pigclaude/api/admin/types"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatTime } from "@/lib/format"
import { TableCard } from "@/components/shell/table-card"
import { useCursorPager } from "@/hooks/use-cursor-pager"
import { adminApi } from "@/lib/api"
import { toastApiError } from "@/lib/errors"
import { ReasonDialog } from "./reason-dialog"
import {
  EmptyRow,
  FilterToolbar,
  InlineLoadError,
  LoadingRows,
  PagerFooter,
  maskIdentifier,
  normalizeUserId,
} from "./table-parts"

/** DevicesSection 保持列表、表单或分页的既有交互契约。 */
export function DevicesSection() {
  const queryClient = useQueryClient()
  const [userInput, setUserInput] = useState("")
  const [userId, setUserId] = useState("")
  const [unbindTarget, setUnbindTarget] = useState<MembershipDeviceItem | null>(null)
  const pager = useCursorPager(["admin-devices", userId], (cursor) =>
    adminApi.devices.list({
      userId: userId || undefined,
      cursor,
      limit: 20,
    }),
  )
  const unbindMutation = useMutation({
    mutationFn: ({ userId: targetUserId, reason }: { userId: string; reason: string }) =>
      adminApi.devices.unbind({ userId: targetUserId, reason }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-devices"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-audits"] })
      toast.success(`已解绑用户 ${variables.userId} 的设备`)
      pager.reset()
      window.dispatchEvent(new Event("pigclaude:admin-device"))
      setUnbindTarget(null)
    },
    onError: toastApiError,
  })

  return (
    <>
      <TableCard
        toolbar={
          <FilterToolbar
            title="设备绑定"
            userLabel="设备用户筛选"
            userInput={userInput}
            onUserInput={setUserInput}
            onApply={() => setUserId(normalizeUserId(userInput))}
          />
        }
        footer={<PagerFooter pager={pager} noun="台设备" />}
      >
        {pager.isError && pager.items.length === 0 ? (
          <InlineLoadError message="设备列表加载失败" onRetry={pager.retry} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>用户 / 设备</TableHead>
                <TableHead>设备公钥哈希</TableHead>
                <TableHead>设备指纹</TableHead>
                <TableHead>最后在线</TableHead>
                <TableHead>Epoch</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.isPending ? (
                <LoadingRows columns={6} />
              ) : pager.items.length === 0 ? (
                <EmptyRow columns={6} message="暂无设备绑定记录" />
              ) : (
                pager.items.map((item) => (
                  <DeviceRow
                    key={`${item.userId}-${item.deviceId}-${item.bindingEpoch}`}
                    item={item}
                    onUnbind={setUnbindTarget}
                  />
                ))
              )}
            </TableBody>
          </Table>
        )}
      </TableCard>
      <ReasonDialog
        open={unbindTarget !== null}
        title="解绑设备"
        reasonLabel="解绑原因"
        description={`解绑用户 ${unbindTarget?.userId ?? ""} 的当前设备后，该设备需要重新授权才能继续使用。`}
        confirmLabel="确认解绑"
        pending={unbindMutation.isPending}
        onOpenChange={(open) => !open && setUnbindTarget(null)}
        onConfirm={(reason) =>
          unbindTarget && unbindMutation.mutate({ userId: unbindTarget.userId, reason })
        }
      />
    </>
  )
}

/** DeviceRow 保持列表、表单或分页的既有交互契约。 */
function DeviceRow({
  item,
  onUnbind,
}: {
  item: MembershipDeviceItem
  onUnbind: (item: MembershipDeviceItem) => void
}) {
  return (
    <TableRow>
      <TableCell>
        <p className="font-mono text-foreground">{item.userId}</p>
        <p className="mt-0.5 font-mono text-xs text-meta">{maskIdentifier(item.deviceId)}</p>
      </TableCell>
      <TableCell>
        <p className="font-mono text-xs text-foreground">
          加密 {maskIdentifier(item.deviceEncryptionPublicKeyHash)}
        </p>
        <p className="mt-0.5 font-mono text-xs text-meta">
          签名 {maskIdentifier(item.deviceSigningPublicKeyHash)}
        </p>
      </TableCell>
      <TableCell className="font-mono text-xs">
        {maskIdentifier(item.deviceFingerprintHash)}
      </TableCell>
      <TableCell>{item.lastSeenAt ? formatTime(item.lastSeenAt) : "暂无"}</TableCell>
      <TableCell className="font-mono">{item.bindingEpoch}</TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="danger" onClick={() => onUnbind(item)}>
          解绑
        </Button>
      </TableCell>
    </TableRow>
  )
}
