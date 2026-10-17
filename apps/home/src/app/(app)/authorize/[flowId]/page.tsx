// 负责读取和批准桌面客户端设备授权，只展示脱敏设备绑定结果。
"use client"

import { useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@pigclaude/web-ui/components/button"
import { homeApi } from "@/lib/api"
import { maskDeviceValue } from "@/lib/device-mask"
import { canApproveAuthorization } from "@/lib/authorization-gate"
import { QueryError, QueryLoading } from "@/components/query-state"
import type { ApproveAuthorizationResponse, AuthorizationResponse } from "@pigclaude/api/home/types"

/** 将设备标识脱敏后渲染，避免把私密设备材料写入页面。 */
function DeviceValue({ value }: { value: string }) {
  return <span className="device-value">{maskDeviceValue(value)}</span>
}

/** 读取授权 flow 和会员状态，只有 pending 且会员有效时允许 approve。 */
export default function AuthorizationPage() {
  const params = useParams<{ flowId: string }>()
  const searchParams = useSearchParams()
  const authorizationState = searchParams.get("state") ?? ""
  const queryClient = useQueryClient()
  const authorizationQueryKey = ["authorization", params.flowId] as const
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [approved, setApproved] = useState<ApproveAuthorizationResponse | null>(null)
  const authorization = useQuery({
    queryKey: authorizationQueryKey,
    queryFn: () => homeApi.authorizations.get(params.flowId),
    retry: false,
  })
  const entitlement = useQuery({
    queryKey: ["entitlement"],
    queryFn: homeApi.membership.entitlement,
    retry: false,
  })
  const approve = useMutation({
    mutationFn: () =>
      homeApi.authorizations.approve(params.flowId, {
        replaceExisting,
        state: authorizationState,
      }),
    onSuccess: (result) => {
      setApproved(result)
      queryClient.setQueryData<AuthorizationResponse>(authorizationQueryKey, (current) =>
        current ? { ...current, status: "approved" } : current,
      )
      void queryClient.invalidateQueries({ queryKey: authorizationQueryKey, refetchType: "none" })
    },
  })
  if (authorization.isPending || entitlement.isPending)
    return (
      <main className="page-shell narrow">
        <QueryLoading label="正在读取设备授权…" />
      </main>
    )
  if (authorization.isError)
    return (
      <main className="page-shell narrow">
        <QueryError error={authorization.error} onRetry={() => void authorization.refetch()} />
      </main>
    )
  if (entitlement.isError)
    return (
      <main className="page-shell narrow">
        <QueryError error={entitlement.error} onRetry={() => void entitlement.refetch()} />
      </main>
    )
  if (approved)
    return (
      <main className="page-shell narrow">
        <section className="home-card">
          <h1 className="page-title">设备已授权</h1>
          <dl className="data-list">
            <div>
              <dt>设备</dt>
              <dd>
                <DeviceValue value={approved.deviceId} />
              </dd>
            </div>
            <div>
              <dt>绑定版本</dt>
              <dd>{approved.bindingEpoch}</dd>
            </div>
          </dl>
          <p className="muted">返回桌面客户端继续使用 PigClaude。</p>
          {approved.location ? (
            <Button asChild>
              <a href={approved.location}>返回桌面客户端</a>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href="/membership">返回会员</Link>
            </Button>
          )}
        </section>
      </main>
    )
  const flow = authorization.data
  const membershipBlocked = entitlement.data.status !== "active"
  const flowBlocked = flow.status !== "pending"
  const stateBlocked = authorizationState.length === 0
  const blocked =
    !canApproveAuthorization({
      flowStatus: flow.status,
      membershipStatus: entitlement.data.status,
      requiresReplace: flow.requiresReplace,
      replaceExisting,
    }) || stateBlocked
  const flowStatusMessage = flowBlocked
    ? `此授权请求当前状态为「${flow.status}」，不能重复确认。`
    : null
  return (
    <main className="page-shell narrow">
      <section className="home-card">
        <h1 className="page-title">确认设备授权</h1>
        <p className="muted">请确认这是你当前使用的 PigClaude 桌面客户端。</p>
        <dl className="data-list">
          <div>
            <dt>设备 ID</dt>
            <dd>
              <DeviceValue value={flow.deviceId} />
            </dd>
          </div>
          <div>
            <dt>设备指纹</dt>
            <dd>
              <DeviceValue value={flow.deviceFingerprintHash} />
            </dd>
          </div>
          <div>
            <dt>授权状态</dt>
            <dd>{flow.status}</dd>
          </div>
        </dl>
        {membershipBlocked && (
          <div className="status-gate" role="alert">
            <strong>当前会员状态不能授权设备</strong>
            <p>请激活有效会员后重新打开授权链接。</p>
          </div>
        )}
        {flowStatusMessage && (
          <div className="status-gate" role="alert">
            <strong>授权请求已结束</strong>
            <p>{flowStatusMessage}</p>
          </div>
        )}
        {stateBlocked && (
          <div className="status-gate" role="alert">
            <strong>授权链接缺少安全状态</strong>
            <p>请从桌面客户端重新打开授权链接。</p>
          </div>
        )}
        {flow.requiresReplace && (
          <div className="status-gate">
            <strong>已有设备绑定</strong>
            <p>确认后会替换现有设备绑定。</p>
            {flow.existingDeviceId && (
              <p>
                当前设备：
                <DeviceValue value={flow.existingDeviceId} />
              </p>
            )}
            <label>
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
                disabled={flowBlocked || membershipBlocked}
              />{" "}
              我确认替换现有设备
            </label>
          </div>
        )}
        {approve.isError && (
          <p role="alert" className="query-error">
            授权失败，请确认会员状态和授权请求状态后重试。
          </p>
        )}
        <div className="button-row">
          <Button
            type="button"
            onClick={() => approve.mutate()}
            disabled={approve.isPending || blocked}
          >
            {approve.isPending ? "授权中…" : "确认授权"}
          </Button>
          <Button asChild variant="outline">
            <Link href="/membership">取消</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
