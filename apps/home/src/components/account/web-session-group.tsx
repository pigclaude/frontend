// 负责设备管理页的「网页登录」分组：当前浏览器排第一，其余可单独退出或一次全部退出。
"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Globe } from "lucide-react"
import type { WebSessionView } from "@pigclaude/contracts/user-web-sessions"
import { Button } from "@pigclaude/web-ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@pigclaude/web-ui/components/dialog"
import { homeApi } from "@/lib/api"
import { useOwnedAction } from "@/lib/use-owned-action"
import { QueryError } from "@/components/query-state"
import { ActivityLabel } from "@/components/account/activity-label"
import { MetaLine } from "@/components/account/meta-line"
import { SetGroup, SetRow, SetTag } from "@/components/account/set-list"

const key = ["web-sessions"]

/** 当前浏览器排第一，其余按最近活跃倒序。 */
export function sortWebSessions(sessions: readonly WebSessionView[]): WebSessionView[] {
  const time = (session: WebSessionView) => new Date(session.lastSeenAt).getTime() || 0
  return [...sessions].sort((left, right) =>
    left.isCurrent !== right.isCurrent ? (left.isCurrent ? -1 : 1) : time(right) - time(left),
  )
}

function signedInLabel(createdAt: string): string | null {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日登录`
}

type Target = { type: "one"; session: WebSessionView } | { type: "others" }

/** 退出前都要确认；成功后重新读取列表，以服务器为准。 */
export function WebSessionGroup({ now }: { now: Date }) {
  const client = useQueryClient()
  const sessions = useQuery({ queryKey: key, queryFn: homeApi.webSessions.list, staleTime: 0 })
  const { pending, run, cancel } = useOwnedAction()
  const [target, setTarget] = useState<Target | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (sessions.isPending)
    return (
      <p role="status" className="query-state">
        正在读取网页登录…
      </p>
    )
  if (sessions.isError)
    return <QueryError error={sessions.error} onRetry={() => void sessions.refetch()} />

  const list = sortWebSessions(sessions.data)
  function confirm() {
    if (!target) return
    setError(null)
    run(
      (isCurrent) =>
        target.type === "one"
          ? homeApi.webSessions.revoke(target.session.id, isCurrent)
          : homeApi.webSessions.revokeOthers(isCurrent),
      {
        onSuccess: () => {
          setTarget(null)
          void client.invalidateQueries({ queryKey: key })
        },
        onError: () => setError("退出失败，请刷新列表后重试"),
      },
    )
  }
  function close() {
    if (pending) return
    cancel()
    setTarget(null)
    setError(null)
  }

  return (
    <>
      <SetGroup
        title={`网页登录 · ${list.length} 个`}
        action={
          list.length > 1 ? (
            <button
              type="button"
              className="set-danger-link"
              disabled={pending}
              onClick={() => setTarget({ type: "others" })}
            >
              退出其他所有网页
            </button>
          ) : undefined
        }
      >
        {list.map((session) => {
          const title = `${session.browser} · ${session.os}`
          return (
            <SetRow
              key={session.id}
              icon={<Globe />}
              title={title}
              badge={session.isCurrent ? <SetTag tone="accent">当前浏览器</SetTag> : undefined}
              description={
                <MetaLine
                  parts={[
                    // 服务端活跃写入有五分钟节流，锁等待超时也会放弃，可能滞后；正在看这页的浏览器一定在使用。
                    <ActivityLabel
                      key="seen"
                      lastSeenAt={session.isCurrent ? now.toISOString() : session.lastSeenAt}
                      now={now}
                    />,
                    session.lastIp,
                    signedInLabel(session.createdAt),
                  ]}
                />
              }
              trailing={
                session.isCurrent ? undefined : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`退出 ${title}`}
                    className="text-[var(--danger-ink)]"
                    disabled={pending}
                    onClick={() => setTarget({ type: "one", session })}
                  >
                    退出
                  </Button>
                )
              }
            />
          )
        })}
      </SetGroup>
      {target && (
        <Dialog open onOpenChange={(open) => !open && close()}>
          <DialogContent showCloseButton={!pending}>
            <DialogTitle>
              {target.type === "one"
                ? `退出 ${target.session.browser} · ${target.session.os}？`
                : "退出其他所有网页？"}
            </DialogTitle>
            <DialogDescription>
              {target.type === "one"
                ? "退出后，那个浏览器需要重新登录。"
                : "退出后，那些浏览器需要重新登录。当前浏览器不受影响。"}
            </DialogDescription>
            {error && (
              <p role="alert" className="query-error">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" disabled={pending} onClick={close}>
                取消
              </Button>
              <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
                {pending ? "正在退出…" : "退出"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
