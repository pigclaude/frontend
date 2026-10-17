// 负责展示设备绑定并通过 Admin API 原子解绑，成功后刷新设备和审计查询。
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { MembershipDeviceItem } from "@pigclaude/api/admin/types"
import { adminApi } from "@/lib/api"
import { useCursorPager } from "@/hooks/use-cursor-pager"
import { toastApiError } from "@/lib/errors"
import { formatTime, maskIdentifier } from "@/lib/format"
import { Pager } from "@/components/shell/pager"

/** 设备绑定列表和解绑原因表单，绝不把私钥或 session 材料渲染到页面。 */
export function DevicesSection() {
  const queryClient = useQueryClient()
  const [userFilter, setUserFilter] = useState("")
  const [appliedUser, setAppliedUser] = useState("")
  const [target, setTarget] = useState<MembershipDeviceItem | null>(null)
  const [reason, setReason] = useState("")
  const pager = useCursorPager(["admin-devices", appliedUser], (cursor) =>
    adminApi.devices.list({
      userId: appliedUser || undefined,
      cursor: cursor || undefined,
      limit: 20,
    }),
  )
  const unbind = useMutation({
    mutationFn: (value: Parameters<typeof adminApi.devices.unbind>[0]) =>
      adminApi.devices.unbind(value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-devices"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-audits"] })
      setTarget(null)
      setReason("")
      pager.reset()
      window.dispatchEvent(new Event("pigclaude:admin-device"))
      toast.success("设备解绑已由服务端确认")
    },
    onError: toastApiError,
  })

  return (
    <>
      <div className="admin-form-row" style={{ marginBottom: 14 }}>
        <label className="admin-field">
          <span>用户 ID</span>
          <input
            aria-label="设备用户筛选"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
          />
        </label>
        <button
          className="admin-button"
          type="button"
          onClick={() => {
            setAppliedUser(userFilter.trim())
            pager.reset()
          }}
        >
          筛选
        </button>
      </div>
      {target ? (
        <div className="admin-dialog-backdrop" role="dialog" aria-label="解绑设备">
          <div className="admin-dialog">
            <h2 style={{ marginTop: 0 }}>解绑 {target.userId} 的设备</h2>
            <p className="admin-muted">
              设备 {maskIdentifier(target.deviceId)} 将在下一次服务端校验时失效。
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (reason.trim()) unbind.mutate({ userId: target.userId, reason: reason.trim() })
              }}
            >
              <label className="admin-field">
                <span>解绑原因</span>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="admin-form-row">
                <button className="admin-button" type="button" onClick={() => setTarget(null)}>
                  取消
                </button>
                <button className="admin-button danger" type="submit" disabled={unbind.isPending}>
                  {unbind.isPending ? "提交中…" : "确认解绑"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {pager.isError ? (
        <div className="admin-error" role="alert">
          设备列表加载失败，请重试。
        </div>
      ) : pager.isPending && pager.items.length === 0 ? (
        <div className="admin-state">正在加载设备…</div>
      ) : pager.items.length === 0 ? (
        <div className="admin-state">暂无设备绑定</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>用户 / 设备</th>
              <th>公钥哈希</th>
              <th>设备指纹</th>
              <th>最后在线</th>
              <th>绑定 epoch</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((item) => (
              <tr key={`${item.userId}-${item.deviceId}`}>
                <td>
                  {item.userId}
                  <div className="admin-muted">{maskIdentifier(item.deviceId)}</div>
                </td>
                <td>
                  <div>{maskIdentifier(item.deviceEncryptionPublicKeyHash)}</div>
                  <div className="admin-muted">
                    {maskIdentifier(item.deviceSigningPublicKeyHash)}
                  </div>
                </td>
                <td>{maskIdentifier(item.deviceFingerprintHash)}</td>
                <td>{formatTime(item.lastSeenAt)}</td>
                <td>{item.bindingEpoch}</td>
                <td>
                  <button
                    className="admin-button danger"
                    type="button"
                    onClick={() => setTarget(item)}
                  >
                    解绑
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
