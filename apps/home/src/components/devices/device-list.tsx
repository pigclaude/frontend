// 负责本人电脑列表的数据与流程：分页、私有命名、单台及全部远程撤销，界面交给电脑分组渲染。
"use client"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@pigclaude/api/client"
import { Button } from "@pigclaude/web-ui/components/button"
import type { SensitiveOperation } from "@pigclaude/api/home/identity"
import { homeApi } from "@/lib/api"
import { takePending } from "@/lib/pending-sensitive-operation"
import { homeSessionGeneration } from "@/lib/session-generation"
import { identityManagement } from "../identity/identity-management"
import { ComputerGroup } from "../account/computer-group"
import { DeviceActions, type DeviceAction } from "./device-actions"
import { deviceManagementError, userDevices } from "./device-management"
const key = ["user-devices"]
/** 网站只显示当前账号关系，不从 UA/query 猜测当前硬件。 */
export function DeviceList({ now }: { now: Date }) {
  const pathname = usePathname()
  const params = useSearchParams()
  return <DeviceListSession key={`${pathname}?${params.toString()}`} now={now} />
}
/** 从供应商核验回来后要续接的移除操作；只在地址带 identityResult=verified 时读取一次。 */
function useResumedRemoval(): SensitiveOperation | null {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [verified] = useState(() => params.get("identityResult") === "verified")
  const [resume, setResume] = useState<SensitiveOperation | null>(null)
  const handled = useRef(false)
  useEffect(() => {
    if (handled.current || !verified) return
    handled.current = true
    const op = takePending()
    if (op?.operation === "revoke_device" || op?.operation === "revoke_all_devices") setResume(op)
    router.replace(pathname)
  }, [pathname, router, verified])
  return resume
}
function DeviceListSession({ now }: { now: Date }) {
  const client = useQueryClient()
  const resume = useResumedRemoval()
  const devices = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => userDevices.list(pageParam),
    getNextPageParam: (page) => (page.length === 50 ? page.at(-1)?.deviceId : undefined),
    staleTime: 0,
  })
  const me = useQuery({ queryKey: ["me"], queryFn: homeApi.user.me })
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
    setNotice(action.type === "rename" ? "名称已保存" : "已移除；那台电脑需要重新授权才能使用")
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
  const resumed = useRef(false)
  useEffect(() => {
    if (!resume || resumed.current || !devices.data) return
    resumed.current = true
    if (resume.operation === "revoke_all_devices") return setAction({ type: "all" })
    if (resume.operation !== "revoke_device") return
    // 只续接仍然存在、并且绑定代次没变的那台电脑；变了就让用户重新选。
    const device = devices.data.pages
      .flat()
      .find(
        (item) =>
          item.deviceId === resume.device_id &&
          item.bindingEpoch === resume.expected_binding_epoch &&
          item.status === "active",
      )
    if (device) setAction({ type: "revoke", device })
  }, [devices.data, resume])
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {error && !action && (
        <p role="alert" className="query-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="account-notice">
          {notice}
        </p>
      )}
      {devices.isError ? (
        <div role="alert" className="query-error">
          <p>设备列表读取失败，请重试。</p>
          <Button variant="outline" onClick={() => void devices.refetch()}>
            刷新列表
          </Button>
        </div>
      ) : devices.isPending ? (
        <p role="status" className="query-state">
          正在读取设备…
        </p>
      ) : (
        <ComputerGroup
          devices={items}
          now={now}
          pending={pending}
          hasMore={devices.hasNextPage}
          loadingMore={devices.isFetchingNextPage}
          onLoadMore={() => void devices.fetchNextPage()}
          onRename={(device) => choose({ type: "rename", device })}
          onRemove={(device) => choose({ type: "revoke", device })}
          onRemoveAll={() => choose({ type: "all" })}
        />
      )}
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
          hasPassword={me.data?.hasPassword ?? true}
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
