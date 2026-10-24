// 负责人工授予弹窗右侧的预览栏：目标用户摘要、填写进度和服务端生效时间线。
import type { GrantPreview, UserPick } from "@pigclaude/api/membership/types"
import { TierBadge } from "@pigclaude/web-ui/components/tier-badge"
import { cn } from "@pigclaude/web-ui/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { formatTime } from "@/lib/format"
import { GrantTimeline } from "./grant-timeline"

/** 填写进度的一项；done 只反映本地输入是否已填，不代表服务端校验通过。 */
export type GrantStep = { label: string; done: boolean }

/** 预览只展示服务端结果；未填完时列出缺少的项，填完等待预览时显示骨架。 */
export function GrantPreviewPanel({
  user,
  steps,
  preview,
  pending,
}: {
  user: UserPick | null
  steps: GrantStep[]
  preview: GrantPreview | undefined
  pending: boolean
}) {
  return (
    <section
      aria-label="授予预览"
      className="flex flex-col gap-4 rounded-xl border border-border bg-[var(--card-elevated)] p-4"
    >
      <h3 className="text-sm font-medium">授予预览</h3>
      <div className="rounded-lg bg-raise-1 p-3">
        {user ? (
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm">{user.email}</p>
            <p className="truncate font-mono text-xs text-meta">{user.userId}</p>
            {user.status === "active" && user.tier && user.validUntil ? (
              <p className="flex flex-wrap items-center gap-1 text-xs text-meta">
                <TierBadge {...user.tier} />
                <span>{formatTime(user.validUntil)} 到期</span>
              </p>
            ) : (
              <p className="text-xs text-meta">当前无会员</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-meta">请选择用户</p>
        )}
      </div>
      {preview ? (
        <GrantTimeline
          now={new Date().toISOString()}
          preview={preview}
          previousTier={user?.status === "active" ? user.tier : null}
        />
      ) : pending ? (
        <div role="status" aria-label="正在预览">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="space-y-2.5">
          <ol className="space-y-2" aria-label="填写进度">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-2 text-xs">
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    step.done
                      ? "border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]"
                      : "border-border",
                  )}
                >
                  {step.done && (
                    <svg viewBox="0 0 12 12" className="size-2.5" fill="none" aria-hidden="true">
                      <path
                        d="m2.5 6.2 2.2 2.2L9.5 3.6"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span className={step.done ? "text-fg-2" : "text-meta"}>
                  {step.label}
                  <span className="sr-only">{step.done ? "（已完成）" : "（未完成）"}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-meta">填写完整后显示生效时间线</p>
        </div>
      )}
    </section>
  )
}
