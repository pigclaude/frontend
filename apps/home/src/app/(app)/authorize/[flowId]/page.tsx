// 负责读取和批准桌面客户端设备授权，只展示脱敏设备绑定结果。
"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Button } from "@pigclaude/web-ui/components/button"
import { homeApi } from "@/lib/api"
import { maskDeviceValue } from "@/lib/device-mask"
import { QueryError, QueryLoading } from "@/components/query-state"

/** 将设备标识脱敏后渲染，避免把私密设备材料写入页面。 */
function DeviceValue({ value }: { value: string }) {
  return <span className="device-value">{maskDeviceValue(value)}</span>
}

/** 读取授权 flow，支持 replace flag 和一次性 approve mutation。 */
export default function AuthorizationPage() {
  const params = useParams<{ flowId: string }>()
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [approved, setApproved] = useState<{ deviceId: string; bindingEpoch: string } | null>(null)
  const authorization = useQuery({
    queryKey: ["authorization", params.flowId],
    queryFn: () => homeApi.authorizations.get(params.flowId),
    retry: false,
  })
  const approve = useMutation({
    mutationFn: () => homeApi.authorizations.approve(params.flowId, { replaceExisting }),
    onSuccess: (result) => setApproved(result),
  })
  if (authorization.isPending)
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
          <Button asChild variant="outline">
            <Link href="/membership">返回会员</Link>
          </Button>
        </section>
      </main>
    )
  const flow = authorization.data
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
        </dl>
        {flow.requiresReplace && (
          <div className="status-gate">
            <strong>已有设备绑定</strong>
            <p>确认后会替换现有设备绑定。</p>
            <label>
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
              />{" "}
              我确认替换现有设备
            </label>
          </div>
        )}
        {approve.isError && (
          <p role="alert" className="query-error">
            授权失败，请确认会员状态后重试。
          </p>
        )}
        <div className="button-row">
          <Button
            type="button"
            onClick={() => approve.mutate()}
            disabled={approve.isPending || (flow.requiresReplace && !replaceExisting)}
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
