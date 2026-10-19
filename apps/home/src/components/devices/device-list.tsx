// 负责本人多设备列表、私有命名、单台及全部远程撤销，结果始终以服务器为准。
"use client"
import { useLayoutEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@pigclaude/api/client"
import { Button } from "@pigclaude/web-ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pigclaude/web-ui/components/table"
import { homeSessionGeneration } from "@/lib/session-generation"
import { identityManagement } from "../identity/identity-management"
import { DeviceActions, type DeviceAction } from "./device-actions"
import { deviceManagementError, userDevices } from "./device-management"
const key = ["user-devices"]
/** 网站只显示当前账号关系，不从 UA/query 猜测当前硬件。 */
export function DeviceList() {
  const pathname = usePathname()
  const params = useSearchParams()
  return <DeviceListSession key={`${pathname}?${params.toString()}`} />
}
function DeviceListSession() {
  const client = useQueryClient()
  const devices = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => userDevices.list(pageParam),
    getNextPageParam: (page) => (page.length === 50 ? page.at(-1)?.deviceId : undefined),
    staleTime: 0,
  })
  const identities = useQuery({
    queryKey: ["linked-identities"],
    queryFn: identityManagement.list,
    staleTime: 0,
  })
  const [action, setAction] = useState<DeviceAction | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)
  const owner = useRef<symbol | null>(null)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
      owner.current = null
    }
  }, [])
  function run(request: (isCurrent: () => boolean) => Promise<void>) {
    if (owner.current || !mounted.current) return
    const current = generation.current
    const session = homeSessionGeneration.current()
    const token = Symbol()
    owner.current = token
    const isCurrent = () =>
      mounted.current &&
      current === generation.current &&
      token === owner.current &&
      session === homeSessionGeneration.current()
    setPending(true)
    setError(null)
    setNotice(null)
    void request(isCurrent)
      .catch((cause: unknown) => {
        if (!isCurrent()) return
        setError(deviceManagementError(cause))
        if (cause instanceof ApiError && cause.status === 409) {
          setAction(null)
          void client.invalidateQueries({ queryKey: key })
        }
      })
      .finally(() => {
        if (isCurrent()) {
          owner.current = null
          setPending(false)
        }
      })
  }
  async function execute(isCurrent: () => boolean, name?: string) {
    if (!action || !isCurrent()) return
    if (action.type === "all") await userDevices.revokeAll(isCurrent)
    else if (action.type === "rename")
      await userDevices.rename(
        action.device.deviceId,
        action.device.bindingEpoch,
        name ?? "",
        isCurrent,
      )
    else await userDevices.revoke(action.device.deviceId, action.device.bindingEpoch, isCurrent)
    if (!isCurrent()) return
    setAction(null)
    setNotice(action.type === "rename" ? "名称已保存" : "设备授权已撤销；当前网站管理会话仍保留")
    await client.invalidateQueries({ queryKey: key })
  }
  function choose(next: DeviceAction) {
    if (pending) return
    generation.current++
    setAction(next)
    setError(null)
    setNotice(null)
  }
  const items = devices.data?.pages.flat() ?? []
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">设备管理</h1>
        <Button
          variant="outline"
          disabled={pending || !items.some((item) => item.status === "active")}
          onClick={() => choose({ type: "all" })}
        >
          撤销全部设备
        </Button>
      </div>
      <p>可管理当前账号的全部设备。撤销后需要重新明确授权，不影响共享设备上的其他账号。</p>
      {error && !action && (
        <p role="alert" className="query-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {devices.isError && (
        <div role="alert">
          <p>设备列表读取失败，请重试。</p>
          <Button variant="outline" onClick={() => void devices.refetch()}>
            刷新列表
          </Button>
        </div>
      )}
      <section className="home-card min-w-0">
        {devices.isPending ? (
          <p role="status">正在读取设备…</p>
        ) : items.length === 0 ? (
          <p>暂无设备授权记录</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>设备 / 平台</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>首次授权</TableHead>
                <TableHead>最近活跃</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.deviceId}>
                  <TableCell>
                    <p>{item.displayName}</p>
                    <p className="font-mono text-xs">{item.deviceId}</p>
                    <p>{item.platform}</p>
                  </TableCell>
                  <TableCell>{item.status === "active" ? "已授权" : "已撤销"}</TableCell>
                  <TableCell>{item.firstAuthorizedAt}</TableCell>
                  <TableCell>{item.lastSeenAt ?? "暂无"}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        disabled={pending}
                        aria-label={`命名 ${item.displayName}`}
                        onClick={() => choose({ type: "rename", device: item })}
                      >
                        命名
                      </Button>
                      <Button
                        variant="outline"
                        disabled={pending || item.status !== "active"}
                        aria-label={`撤销 ${item.displayName}`}
                        onClick={() => choose({ type: "revoke", device: item })}
                      >
                        撤销
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {devices.hasNextPage && (
          <Button
            variant="outline"
            disabled={devices.isFetchingNextPage}
            onClick={() => void devices.fetchNextPage()}
          >
            加载更多设备
          </Button>
        )}
      </section>
      {identities.isError && (
        <p role="alert">
          登录方式读取失败，仍可使用密码核验。
          <Button variant="ghost" onClick={() => void identities.refetch()}>
            重试登录方式
          </Button>
        </p>
      )}
      {action && (
        <DeviceActions
          key={JSON.stringify(action)}
          action={action}
          identities={identities.data ?? []}
          pending={pending}
          error={error}
          run={run}
          execute={execute}
          close={() => {
            generation.current++
            setAction(null)
            setError(null)
          }}
        />
      )}
    </div>
  )
}
