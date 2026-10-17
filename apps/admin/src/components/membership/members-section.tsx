// 负责展示会员列表并处理服务端授予、撤销和查询失效流程。
import { FormEvent, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MembershipItem, MembershipStatus } from "@pigclaude/api/admin/types"
import { adminApi } from "@/lib/api"
import { useCursorPager } from "@/hooks/use-cursor-pager"
import { toastApiError } from "@/lib/errors"
import { formatTime } from "@/lib/format"
import { Pager } from "@/components/shell/pager"

/** 会员列表、人工授予和撤销表单，mutation 只使用服务端返回快照。 */
export function MembersSection() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<MembershipStatus | "">("")
  const [showGrant, setShowGrant] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<MembershipItem | null>(null)
  const pager = useCursorPager(["admin-memberships", status], (cursor) =>
    adminApi.membership.list({ status, cursor: cursor || undefined, limit: 20 }),
  )
  const grant = useMutation({
    mutationFn: (value: Parameters<typeof adminApi.membership.grant>[0]) =>
      adminApi.membership.grant(value),
    onSuccess: (membership) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-memberships"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-audits"] })
      setShowGrant(false)
      setRevokeTarget(null)
      pager.reset()
      window.dispatchEvent(new CustomEvent("pigclaude:admin-membership", { detail: membership }))
      toast.success(`会员 ${membership.userId} 已由服务端确认`)
    },
    onError: toastApiError,
  })
  const revoke = useMutation({
    mutationFn: (value: Parameters<typeof adminApi.membership.revoke>[0]) =>
      adminApi.membership.revoke(value),
    onSuccess: (membership) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-memberships"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-audits"] })
      setRevokeTarget(null)
      pager.reset()
      window.dispatchEvent(new CustomEvent("pigclaude:admin-membership", { detail: membership }))
      toast.success(`会员 ${membership.userId} 已撤销`)
    },
    onError: toastApiError,
  })

  return (
    <>
      <div className="admin-form-row" style={{ marginBottom: 14 }}>
        <label className="admin-field">
          <span>状态筛选</span>
          <select
            aria-label="会员状态"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as MembershipStatus | "")
              pager.reset()
            }}
          >
            <option value="">全部状态</option>
            <option value="active">有效</option>
            <option value="expired">已过期</option>
            <option value="revoked">已撤销</option>
          </select>
        </label>
        <button className="admin-button primary" type="button" onClick={() => setShowGrant(true)}>
          人工授予
        </button>
      </div>
      {showGrant ? (
        <GrantForm
          pending={grant.isPending}
          onCancel={() => setShowGrant(false)}
          onSubmit={(value) => grant.mutate(value)}
        />
      ) : null}
      {revokeTarget ? (
        <ReasonForm
          title={`撤销用户 ${revokeTarget.userId} 的会员`}
          pending={revoke.isPending}
          onCancel={() => setRevokeTarget(null)}
          onSubmit={(reason) => revoke.mutate({ userId: revokeTarget.userId, reason })}
        />
      ) : null}
      {pager.isError ? (
        <div className="admin-error" role="alert">
          会员列表加载失败，请重试。
        </div>
      ) : pager.isPending && pager.items.length === 0 ? (
        <div className="admin-state">正在加载会员…</div>
      ) : pager.items.length === 0 ? (
        <div className="admin-state">暂无会员记录</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>套餐</th>
              <th>状态</th>
              <th>有效期</th>
              <th>版本</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((item) => (
              <tr key={`${item.userId}-${item.entitlementVersion}`}>
                <td>{item.userId}</td>
                <td>
                  {item.planId} · {item.planKind}
                </td>
                <td>{item.status}</td>
                <td>{item.lifetime ? "产品生命周期永久授权" : formatTime(item.validUntil)}</td>
                <td>{item.entitlementVersion}</td>
                <td>
                  <button
                    className="admin-button danger"
                    type="button"
                    disabled={item.status === "revoked" || revoke.isPending}
                    onClick={() => setRevokeTarget(item)}
                  >
                    撤销
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager hasNext={pager.hasNext} isFetching={pager.isFetching} onNext={pager.goNext} />
    </>
  )
}

interface GrantFormProps {
  pending: boolean
  onCancel: () => void
  onSubmit: (value: {
    userId: string
    planId: string
    termsVersion: string
    remark: string
  }) => void
}

function GrantForm({ pending, onCancel, onSubmit }: GrantFormProps) {
  const [userId, setUserId] = useState("")
  const [planId, setPlanId] = useState("")
  const [termsVersion, setTermsVersion] = useState("v1")
  const [remark, setRemark] = useState("")
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!userId.trim() || !planId.trim() || !termsVersion.trim() || !remark.trim()) return
    onSubmit({
      userId: userId.trim(),
      planId: planId.trim(),
      termsVersion: termsVersion.trim(),
      remark: remark.trim(),
    })
  }
  return (
    <div className="admin-dialog-backdrop" role="dialog" aria-label="人工授予会员">
      <div className="admin-dialog">
        <h2 style={{ marginTop: 0 }}>人工授予会员</h2>
        <form onSubmit={submit}>
          <label className="admin-field">
            <span>用户 ID</span>
            <input value={userId} onChange={(event) => setUserId(event.target.value)} />
          </label>
          <label className="admin-field">
            <span>套餐 ID</span>
            <input value={planId} onChange={(event) => setPlanId(event.target.value)} />
          </label>
          <label className="admin-field">
            <span>条款版本</span>
            <input value={termsVersion} onChange={(event) => setTermsVersion(event.target.value)} />
          </label>
          <label className="admin-field">
            <span>操作备注</span>
            <textarea value={remark} onChange={(event) => setRemark(event.target.value)} />
          </label>
          <div className="admin-form-row">
            <button className="admin-button" type="button" onClick={onCancel}>
              取消
            </button>
            <button className="admin-button primary" type="submit" disabled={pending}>
              {pending ? "提交中…" : "确认授予"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface ReasonFormProps {
  title: string
  pending: boolean
  onCancel: () => void
  onSubmit: (reason: string) => void
}

function ReasonForm({ title, pending, onCancel, onSubmit }: ReasonFormProps) {
  const [reason, setReason] = useState("")
  return (
    <div className="admin-dialog-backdrop" role="dialog" aria-label={title}>
      <div className="admin-dialog">
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (reason.trim()) onSubmit(reason.trim())
          }}
        >
          <label className="admin-field">
            <span>原因</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="admin-form-row">
            <button className="admin-button" type="button" onClick={onCancel}>
              取消
            </button>
            <button className="admin-button danger" type="submit" disabled={pending}>
              {pending ? "提交中…" : "确认"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
