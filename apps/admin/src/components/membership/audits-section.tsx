// 负责展示不可变安全审计记录，并把筛选和分页交给 Admin API。
import { useState } from "react"
import { adminApi } from "@/lib/api"
import { useCursorPager } from "@/hooks/use-cursor-pager"
import { formatTime, maskIdentifier } from "@/lib/format"
import { Pager } from "@/components/shell/pager"

/** 渲染授予、撤销和设备解绑审计，保持服务端记录的操作人和原因。 */
export function AuditsSection() {
  const [userFilter, setUserFilter] = useState("")
  const [eventFilter, setEventFilter] = useState("")
  const [applied, setApplied] = useState({ userId: "", eventType: "" })
  const pager = useCursorPager(["admin-audits", applied.userId, applied.eventType], (cursor) =>
    adminApi.audits.list({
      userId: applied.userId || undefined,
      eventType: applied.eventType || undefined,
      cursor: cursor || undefined,
      limit: 20,
    }),
  )
  return (
    <>
      <div className="admin-form-row" style={{ marginBottom: 14 }}>
        <label className="admin-field">
          <span>用户 ID</span>
          <input
            aria-label="审计用户筛选"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>事件类型</span>
          <input
            aria-label="审计事件筛选"
            value={eventFilter}
            onChange={(event) => setEventFilter(event.target.value)}
          />
        </label>
        <button
          className="admin-button"
          type="button"
          onClick={() => {
            setApplied({ userId: userFilter.trim(), eventType: eventFilter.trim() })
            pager.reset()
          }}
        >
          筛选
        </button>
      </div>
      {pager.isError ? (
        <div className="admin-error" role="alert">
          审计列表加载失败，请重试。
        </div>
      ) : pager.isPending && pager.items.length === 0 ? (
        <div className="admin-state">正在加载审计…</div>
      ) : pager.items.length === 0 ? (
        <div className="admin-state">暂无安全审计记录</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>用户 / 操作人</th>
              <th>事件 / 结果</th>
              <th>设备 / epoch</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            {pager.items.map((item) => (
              <tr key={item.id}>
                <td>{formatTime(item.createdAt)}</td>
                <td>
                  {item.userId}
                  <div className="admin-muted">
                    {item.operatorType} · {item.operatorId || "—"}
                  </div>
                </td>
                <td>
                  {item.eventType}
                  <div className="admin-muted">结果：{item.result || "—"}</div>
                </td>
                <td>
                  {item.deviceId ? maskIdentifier(item.deviceId) : "—"}
                  <div className="admin-muted">{item.bindingEpoch || "—"}</div>
                </td>
                <td>
                  {item.reason || "—"}
                  <div className="admin-muted">
                    {[item.clientIp, item.userAgent].filter(Boolean).join(" · ")}
                  </div>
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
