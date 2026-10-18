// 负责展示仅含字段名的设置审计分页，保持设置卡片的紧凑行布局。
import type { SettingsAuditPage } from "@pigclaude/contracts/security-settings"
import { Button } from "@/components/ui/button"
/** 展示服务端脱敏审计，不渲染任意原始 JSON 或配置值。 */
export function TurnstileSettingsHistory({
  data,
  error,
  onNext,
  onRetry,
}: {
  data?: SettingsAuditPage
  error: boolean
  onNext: (cursor?: string) => void
  onRetry: () => void
}) {
  return (
    <section className="rounded-xl border border-border bg-[var(--card-bg)] p-5">
      <h2 className="text-sm font-medium">变更历史</h2>
      {error ? (
        <div role="alert">
          历史加载失败{" "}
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试历史
          </Button>
        </div>
      ) : !data ? (
        <p role="status">加载中…</p>
      ) : (
        <>
          <ul className="divide-y divide-border-soft">
            {data.items.map((item) => (
              <li key={item.revision} className="break-words py-3 text-xs">
                <p>
                  {item.type} · 版本 {item.revision} · {item.actor}
                </p>
                <p className="mt-1 text-meta">
                  {item.time} · {item.changedFields.join("、")}
                </p>
              </li>
            ))}
          </ul>
          {data.items.length === 0 && <p className="mt-3 text-xs text-meta">暂无变更记录</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onNext()}>
              最新记录
            </Button>
            {data.nextCursor && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNext(data.nextCursor ?? undefined)}
              >
                下一页
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
