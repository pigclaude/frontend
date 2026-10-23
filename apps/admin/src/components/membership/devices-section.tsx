// 负责按已知用户 ID 管理多设备关系，仅依赖独立设备权限，不读取用户资料。
import { useLayoutEffect, useState } from "react"
import { useLocation, useSearchParams } from "react-router"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@pigclaude/api/client"
import type { UserDeviceView } from "@pigclaude/contracts/user-devices"
import { Skeleton } from "@/components/ui/skeleton"
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
import { adminApi } from "@/lib/api"
import { useAdminMe } from "@/hooks/use-admin-me"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { canAdminPermission } from "@/lib/admin-permissions"
import { accountOperationError } from "@/lib/account-errors"
import { ReasonDialog } from "./reason-dialog"
import { EmptyRow, FilterToolbar, InlineLoadError, LoadingRows } from "./table-parts"
interface Target {
  userId: string
  device: UserDeviceView
  authVersion: string
}
/** 设备 operator 只需精确 device:read；撤销额外要求 device:revoke。 */
export function DevicesSection() {
  const location = useLocation()
  return <DevicesSectionSession key={location.key} />
}
function DevicesSectionSession() {
  const [params, setParams] = useSearchParams()
  const { data: me, isPending: loadingMe } = useAdminMe()
  const userId = params.get("userId") ?? ""
  const [userInput, setUserInput] = useState(userId)
  const [target, setTarget] = useState<Target | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const canRead = me?.status === "active" && canAdminPermission(me.permissions, "device:read")
  const canRevoke = canRead && canAdminPermission(me.permissions, "device:revoke")
  useLayoutEffect(() => {
    if (!canRevoke) setTarget(null)
  }, [canRevoke])
  const client = useQueryClient()
  const query = useInfiniteQuery({
    queryKey: ["admin-user-devices", userId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => adminApi.devices.forUser(userId, pageParam),
    getNextPageParam: (page) =>
      page.devices.length === 50 ? page.devices.at(-1)?.deviceId : undefined,
    enabled: canRead && !!userId,
    staleTime: 0,
    retry: false,
  })
  const operation = useAdminOperationOwner(
    JSON.stringify([
      userId,
      me?.id,
      me?.permissions,
      canRevoke,
      target?.userId,
      target?.device.deviceId,
      target?.device.bindingEpoch,
      target?.authVersion,
    ]),
  )
  async function revoke(reason: string) {
    if (!target || target.userId !== userId || !canRevoke || query.isError || query.isFetching)
      return
    const owner = operation.begin()
    if (!owner) return
    setError(null)
    setNotice(null)
    try {
      await adminApi.devices.revoke(
        target.userId,
        target.device.deviceId,
        {
          expectedAuthVersion: target.authVersion,
          expectedBindingEpoch: target.device.bindingEpoch,
          reason,
        },
        owner.isCurrent,
      )
      if (!owner.isCurrent()) return
      setTarget(null)
      setNotice("指定设备关系已撤销，该账号的其他设备保持原状。")
      void client.invalidateQueries({ queryKey: ["admin-user-devices", userId] })
      void client.invalidateQueries({ queryKey: ["admin-audits"] })
      window.dispatchEvent(new Event("pigclaude:admin-device"))
    } catch (cause) {
      if (!owner.isCurrent()) return
      setError(accountOperationError(cause))
      if (cause instanceof ApiError && cause.status === 409) {
        setTarget(null)
        void client.invalidateQueries({ queryKey: ["admin-user-devices", userId] })
      }
    } finally {
      owner.finish()
    }
  }
  if (loadingMe)
    return (
      <div role="status" aria-label="正在读取管理员权限" className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  if (!canRead) return <p role="alert">缺少设备读取权限</p>
  const rows =
    query.data?.pages.flatMap((page) =>
      page.devices.map((device) => ({ device, authVersion: page.authVersion })),
    ) ?? []
  return (
    <>
      {error && !target && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <TableCard
        toolbar={
          <FilterToolbar
            title="设备绑定"
            userLabel="设备用户筛选"
            hint="输入已知用户 ID，查看该账号设备"
            userInput={userInput}
            onUserInput={setUserInput}
            onApply={() => {
              setTarget(null)
              setError(null)
              setNotice(null)
              const next = userInput.trim()
              setParams(next ? { userId: next } : {})
            }}
          />
        }
        footer={
          <>
            <span>已读取 {rows.length} 台设备</span>
            {query.hasNextPage && (
              <Button
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                加载更多设备
              </Button>
            )}
          </>
        }
      >
        {!userId ? (
          <p className="p-5 text-sm text-muted-foreground">
            请输入目标用户 ID，不需要用户资料读取权限。
          </p>
        ) : (
          <>
            {query.isError && (
              <InlineLoadError message="设备列表加载失败" onRetry={() => void query.refetch()} />
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户 / 设备</TableHead>
                  <TableHead>平台 / 状态</TableHead>
                  <TableHead>首次授权</TableHead>
                  <TableHead>最近活跃</TableHead>
                  <TableHead>Epoch</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isPending ? (
                  <LoadingRows columns={6} />
                ) : rows.length === 0 ? (
                  <EmptyRow columns={6} message="暂无设备授权记录" />
                ) : (
                  rows.map(({ device, authVersion }) => (
                    <TableRow key={device.deviceId}>
                      <TableCell>
                        <p className="font-mono">{userId}</p>
                        <p>{device.displayName}</p>
                        <p className="font-mono text-xs">{device.deviceId}</p>
                      </TableCell>
                      <TableCell>
                        {device.platform} / {device.status === "active" ? "已授权" : "已撤销"}
                      </TableCell>
                      <TableCell>{formatTime(device.firstAuthorizedAt)}</TableCell>
                      <TableCell>
                        {device.lastSeenAt ? formatTime(device.lastSeenAt) : "暂无"}
                      </TableCell>
                      <TableCell className="font-mono">{device.bindingEpoch}</TableCell>
                      <TableCell>
                        {canRevoke && (
                          <Button
                            size="sm"
                            variant="danger"
                            aria-label={`撤销 ${device.displayName}`}
                            disabled={
                              operation.pending ||
                              query.isFetching ||
                              query.isError ||
                              device.status !== "active"
                            }
                            onClick={() => {
                              setTarget({ userId, device, authVersion })
                              setError(null)
                            }}
                          >
                            撤销
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </>
        )}
      </TableCard>
      <ReasonDialog
        open={target !== null}
        title="撤销设备授权"
        description="仅撤销该账号与所选设备的授权关系，设备需要重新明确授权。"
        error={error}
        reasonLabel="操作原因"
        confirmLabel="确认撤销"
        pending={operation.pending}
        preserveWhitespace
        maxCharacters={500}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        onConfirm={(reason) => void revoke(reason)}
      />
    </>
  )
}
